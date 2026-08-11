/**
 * Local desktop packaging orchestrator.
 *
 * Builds Selection installers for:
 *   - macOS arm64 DMG  (host: macOS preferred)
 *   - Windows x64 NSIS  (cross-compile from macOS/Linux supported)
 *
 * Usage:
 *   bun run scripts/package-desktop.ts              # both
 *   bun run scripts/package-desktop.ts --mac-only
 *   bun run scripts/package-desktop.ts --win-only
 *
 * Artifacts are copied to dist-packages/ at the repo root.
 */

import { $ } from 'bun'
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
} from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  type BuildConfig,
  type Platform,
  type Arch,
  cleanBuildArtifacts,
  installDependencies,
  downloadBun,
  downloadUv,
  copySDK,
  verifySDKCopy,
  copyRipgrep,
  copyInterceptor,
  buildMcpServers,
  copySessionServer,
  copyPiAgentServer,
  buildWhatsAppWorker,
  buildElectronApp,
  loadEnvFile,
} from './build/common'
import { packageDarwin } from './build/darwin'
import { packageWindows } from './build/win32'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')
const ELECTRON_DIR = join(ROOT_DIR, 'apps', 'electron')
const OUT_DIR = join(ROOT_DIR, 'dist-packages')

const args = new Set(process.argv.slice(2))
const macOnly = args.has('--mac-only')
const winOnly = args.has('--win-only')
const doMac = !winOnly
const doWin = !macOnly

function makeConfig(platform: Platform, arch: Arch): BuildConfig {
  return {
    platform,
    arch,
    upload: false,
    uploadLatest: false,
    uploadScript: false,
    rootDir: ROOT_DIR,
    electronDir: ELECTRON_DIR,
  }
}

/**
 * Fetch a platform-specific claude-agent-sdk binary package into root node_modules
 * when cross-compiling (host arch/platform differs from target).
 */
async function ensureSdkBinaryPackage(platform: Platform, arch: Arch): Promise<void> {
  const pkg =
    platform === 'darwin'
      ? `claude-agent-sdk-darwin-${arch}`
      : platform === 'win32'
        ? `claude-agent-sdk-win32-${arch}`
        : `claude-agent-sdk-linux-${arch}`

  const dest = join(ROOT_DIR, 'node_modules', '@anthropic-ai', pkg)
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    console.log(`SDK binary package already present: ${pkg}`)
    return
  }

  const packageJson = await Bun.file(join(ROOT_DIR, 'package.json')).json() as {
    dependencies?: Record<string, string>
  }
  const version = packageJson.dependencies?.['@anthropic-ai/claude-agent-sdk']
  if (!version) {
    throw new Error('Could not resolve @anthropic-ai/claude-agent-sdk version from package.json')
  }

  console.log(`Fetching @anthropic-ai/${pkg}@${version} for target ${platform}-${arch}...`)
  const tmp = join(ELECTRON_DIR, `.sdk-fetch-${pkg}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })

  try {
    await $`cd ${tmp} && npm pack @anthropic-ai/${pkg}@${version}`.quiet()
    const tarball = readdirSync(tmp).find((f) => f.endsWith('.tgz'))
    if (!tarball) throw new Error(`npm pack produced no tarball for ${pkg}`)
    await $`cd ${tmp} && tar -xzf ${tarball}`.quiet()
    mkdirSync(dest, { recursive: true })
    cpSync(join(tmp, 'package'), dest, { recursive: true })
    console.log(`  Staged ${pkg} → ${dest}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * When packaging Windows on a non-Windows host, @vscode/ripgrep only has the
 * host rg binary. Download the Windows x64 ripgrep into the staged tree.
 */
async function ensureWindowsRipgrepInStaging(): Promise<void> {
  const stagedBin = join(ELECTRON_DIR, 'node_modules', '@vscode', 'ripgrep', 'bin')
  const target = join(stagedBin, 'rg.exe')
  if (existsSync(target)) {
    console.log('Windows ripgrep already staged (rg.exe)')
    return
  }

  // Same prebuilt version as @vscode/ripgrep@1.17.1 postinstall
  const version = 'v15.0.1'
  const asset = `ripgrep-${version}-x86_64-pc-windows-msvc.zip`
  const url = `https://github.com/microsoft/ripgrep-prebuilt/releases/download/${version}/${asset}`
  const tmp = join(ELECTRON_DIR, '.rg-win-download')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  mkdirSync(stagedBin, { recursive: true })

  try {
    console.log(`Downloading Windows ripgrep ${version}...`)
    const zipPath = join(tmp, asset)
    await $`curl -fsSL --retry 3 --retry-delay 2 -o ${zipPath} ${url}`
    await $`unzip -o ${zipPath} -d ${tmp}`.quiet()
    // Archive may contain rg.exe at root or nested
    const findExe = (dir: string): string | null => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name)
        if (name.isFile() && name.name === 'rg.exe') return p
        if (name.isDirectory()) {
          const nested = findExe(p)
          if (nested) return nested
        }
      }
      return null
    }
    const exe = findExe(tmp)
    if (!exe) throw new Error('rg.exe not found in downloaded ripgrep archive')
    copyFileSync(exe, target)
    console.log(`  Staged Windows rg.exe → ${target}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * copyRipgrep for win32 requires rg.exe on host tree. On non-Windows hosts the
 * host package only has `rg`. Stage host package first, then inject rg.exe.
 */
async function copyRipgrepForTarget(config: BuildConfig): Promise<void> {
  if (config.platform === 'win32' && process.platform !== 'win32') {
    // Copy host @vscode/ripgrep package (JS + whatever bin exists), then add rg.exe
    const { rootDir, electronDir } = config
    const rgSource = join(rootDir, 'node_modules', '@vscode', 'ripgrep')
    if (!existsSync(rgSource)) {
      throw new Error('@vscode/ripgrep not installed. Run bun install first.')
    }
    const rgScope = join(electronDir, 'node_modules', '@vscode')
    const rgDest = join(rgScope, 'ripgrep')
    console.log('Copying @vscode/ripgrep (host package, will inject Windows binary)...')
    mkdirSync(rgScope, { recursive: true })
    if (existsSync(rgDest)) rmSync(rgDest, { recursive: true, force: true })
    cpSync(rgSource, rgDest, { recursive: true, dereference: true })
    await ensureWindowsRipgrepInStaging()
    return
  }
  copyRipgrep(config)
}

async function prepareAndBuildApp(config: BuildConfig): Promise<void> {
  console.log(`\n========== Prepare ${config.platform}-${config.arch} ==========\n`)
  cleanBuildArtifacts(config)
  await installDependencies(config)
  await downloadBun(config)
  await downloadUv(config)
  await ensureSdkBinaryPackage(config.platform, config.arch)
  copySDK(config)
  verifySDKCopy(config)
  await copyRipgrepForTarget(config)

  copyInterceptor(config)
  buildMcpServers(config)
  copySessionServer(config)
  copyPiAgentServer(config)
  buildWhatsAppWorker(config)

  await buildElectronApp(config)
}

function collectArtifact(name: string, srcDir: string, pattern: (f: string) => boolean): string | null {
  if (!existsSync(srcDir)) return null
  const files = readdirSync(srcDir)
  const match = files.find(pattern)
  if (!match) return null
  const src = join(srcDir, match)
  const dest = join(OUT_DIR, match)
  mkdirSync(OUT_DIR, { recursive: true })
  cpSync(src, dest)
  console.log(`  → ${dest}`)
  return dest
}

async function buildMacArm64(): Promise<void> {
  const config = makeConfig('darwin', 'arm64')
  await loadEnvFile(config)

  // Prefer official shell script for parity with release pipeline
  console.log('\n========== Building macOS arm64 DMG ==========\n')
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false'

  // Use TypeScript pipeline so we stay consistent with cross-win and share downloads
  await prepareAndBuildApp(config)
  await packageDarwin(config)

  collectArtifact('dmg', join(ELECTRON_DIR, 'release'), (f) => f === 'Selection-arm64.dmg')
  collectArtifact('zip', join(ELECTRON_DIR, 'release'), (f) => f === 'Selection-arm64.zip')
}

async function buildWinX64(): Promise<void> {
  const config = makeConfig('win32', 'x64')
  await loadEnvFile(config)

  console.log('\n========== Building Windows x64 NSIS installer ==========\n')
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

  await prepareAndBuildApp(config)

  // electron-builder NSIS on non-Windows hosts works for unsigned packages
  await packageWindows(config)

  collectArtifact(
    'exe',
    join(ELECTRON_DIR, 'release'),
    (f) => f.endsWith('.exe') && !f.includes('blockmap') && (f.includes('x64') || f.includes('Setup') || f.startsWith('Selection')),
  )
}

async function main(): Promise<void> {
  console.log('Selection desktop packaging')
  console.log(`  Root: ${ROOT_DIR}`)
  console.log(`  Mac arm64: ${doMac}`)
  console.log(`  Win x64:   ${doWin}`)
  console.log(`  Output:    ${OUT_DIR}`)

  mkdirSync(OUT_DIR, { recursive: true })

  const started = Date.now()
  const results: string[] = []

  if (doMac) {
    if (process.platform !== 'darwin') {
      throw new Error('macOS arm64 packaging requires a macOS host')
    }
    await buildMacArm64()
    results.push('macOS arm64')
  }

  if (doWin) {
    await buildWinX64()
    results.push('Windows x64')
  }

  // Write a small summary
  const summary = {
    builtAt: new Date().toISOString(),
    targets: results,
    artifacts: existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : [],
    durationSec: Math.round((Date.now() - started) / 1000),
  }
  writeFileSync(join(OUT_DIR, 'build-summary.json'), JSON.stringify(summary, null, 2))

  console.log('\n========== Packaging complete ==========')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\nArtifacts in: ${OUT_DIR}`)
}

main().catch((err) => {
  console.error('\nPackaging failed:', err)
  process.exit(1)
})
