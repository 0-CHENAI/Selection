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
  downloadOfficecli,
  downloadUv,
  copyRipgrep,
  copyInterceptor,
  buildMcpServers,
  copySessionServer,
  copyPiAgentServer,
  buildWhatsAppWorker,
  buildElectronApp,
  loadEnvFile,
  curlDownload,
  resignNativeBuildTools,
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
    const cachedZip = join(ELECTRON_DIR, '.cache', 'downloads', asset)
    if (existsSync(cachedZip)) {
      console.log(`  Using cached ${cachedZip}`)
      copyFileSync(cachedZip, zipPath)
    } else {
      await curlDownload(zipPath, [
        url,
        `https://npmmirror.com/mirrors/ripgrep-prebuilt/${version}/${asset}`,
        `https://gitclone.com/github.com/microsoft/ripgrep-prebuilt/releases/download/${version}/${asset}`,
      ])
      mkdirSync(dirname(cachedZip), { recursive: true })
      copyFileSync(zipPath, cachedZip)
    }
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
  // When cross-compiling from macOS/Linux, do NOT use Windows hoisted install —
  // it can replace host-native esbuild with a broken/incompatible binary.
  // Only use platform-specific install when the host matches the target.
  if (process.platform === config.platform) {
    await installDependencies(config)
  } else {
    console.log('Cross-compile host ≠ target: using normal bun install for host tooling...')
    await $`cd ${ROOT_DIR} && bun install`.quiet()
  }
  resignNativeBuildTools(ROOT_DIR)
  await downloadBun(config)
  await downloadUv(config)
  await downloadOfficecli(config)
  await copyRipgrepForTarget(config)

  copyInterceptor(config)
  buildMcpServers(config)
  copySessionServer(config)
  copyPiAgentServer(config)
  try {
    buildWhatsAppWorker(config)
  } catch (err) {
    // OOM on constrained hosts: reuse existing worker.cjs if present
    const workerOut = join(ROOT_DIR, 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs')
    if (existsSync(workerOut)) {
      console.warn('buildWhatsAppWorker failed; reusing existing worker.cjs:', workerOut)
    } else {
      throw err
    }
  }

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
