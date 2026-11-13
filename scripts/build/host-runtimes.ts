/**
 * Download relocatable Git and CPython into apps/electron/vendor/{git,python}
 * so packaged desktops work without a system Git or Python.
 *
 * Git:
 *   macOS / Linux — dugite-native (real Git, not the Xcode CLT stub)
 *   Windows — Git for Windows (includes bash.exe; MinGit does not)
 *
 * Python:
 *   python-build-standalone CPython 3.12, the same family uv downloads.
 *   Shipped in the installer so `uv run --python 3.12` stays offline.
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import {
  curlDownload,
  extractArchive,
  getPlatformKey,
  verifySha256,
  type Arch,
  type BuildConfig,
  type Platform,
} from './common'

export const DUGITE_NATIVE_VERSION = 'v2.56.1'
export const DUGITE_NATIVE_ASSET = 'v2.56.1-238326e'
export const GIT_FOR_WINDOWS_VERSION = 'v2.56.1.windows.1'
export const PYTHON_STANDALONE_TAG = '20261026'
export const PYTHON_STANDALONE_VERSION = '3.12.16'

const LARGE_DOWNLOAD_TIMEOUT_MS = 600_000

interface RuntimeStamp {
  kind: 'git' | 'python'
  version: string
  platform: Platform
  arch: Arch
}

interface GitArtifact {
  fileName: string
  url: string
  sha256: string
  version: string
}

interface PythonArtifact {
  fileName: string
  url: string
  sha256: string
}

const GIT_ARTIFACTS: Record<string, GitArtifact> = {
  'darwin-arm64': {
    fileName: `dugite-native-${DUGITE_NATIVE_ASSET}-macOS-arm64.tar.gz`,
    url: `https://github.com/desktop/dugite-native/releases/download/${DUGITE_NATIVE_VERSION}/dugite-native-${DUGITE_NATIVE_ASSET}-macOS-arm64.tar.gz`,
    sha256: 'a882ec6882416b57d212a22bac845ae27944f96cf73453a864f6a12c17863a79',
    version: `${DUGITE_NATIVE_VERSION}+git-2.56.1`,
  },
  'darwin-x64': {
    fileName: `dugite-native-${DUGITE_NATIVE_ASSET}-macOS-x64.tar.gz`,
    url: `https://github.com/desktop/dugite-native/releases/download/${DUGITE_NATIVE_VERSION}/dugite-native-${DUGITE_NATIVE_ASSET}-macOS-x64.tar.gz`,
    sha256: '3fdb0c2f102fe0273d64b5d5fb77315c19f2b4648a154593723cb9ed98f2bc7d',
    version: `${DUGITE_NATIVE_VERSION}+git-2.56.1`,
  },
  'linux-x64': {
    fileName: `dugite-native-${DUGITE_NATIVE_ASSET}-ubuntu-x64.tar.gz`,
    url: `https://github.com/desktop/dugite-native/releases/download/${DUGITE_NATIVE_VERSION}/dugite-native-${DUGITE_NATIVE_ASSET}-ubuntu-x64.tar.gz`,
    sha256: 'e5bc3e8e80b57a5bcd8da18d59b23f5b39533d19019ac1d50b0bd34f051d111d',
    version: `${DUGITE_NATIVE_VERSION}+git-2.56.1`,
  },
  'win32-x64': {
    fileName: 'Git-2.56.1-64-bit.tar.bz2',
    url: `https://github.com/git-for-windows/git/releases/download/${GIT_FOR_WINDOWS_VERSION}/Git-2.56.1-64-bit.tar.bz2`,
    sha256: 'd7d89e69855f00e73d957b513c49538a420c465c84b9d212cf1add400eecdf54',
    version: GIT_FOR_WINDOWS_VERSION,
  },
}

const PYTHON_TRIPLES: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

const PYTHON_SHA256: Record<string, string> = {
  'darwin-arm64': '353d5f1b4fd2715e7053f12f068435d5bbad16b91e057006b5d01e0925709a7e',
  'darwin-x64': '37c38fda76fec1fbf310adcbafb7f0d96af13b5511bf8ea954c3aa8eec185734',
  'linux-x64': 'ce4f6d0a6cfdb3bed6e44c2f9affd85943c76a42e25ad3a259002f31d6fb8a20',
  'win32-x64': '1f2ab53880fc67ea323398c6388e05af28addc99a8e389209f08a51fdff4b149',
}

export function getGitArtifact(platform: Platform, arch: Arch): GitArtifact {
  const key = getPlatformKey(platform, arch)
  const artifact = GIT_ARTIFACTS[key]
  if (!artifact) throw new Error(`No bundled Git artifact for ${key}`)
  return artifact
}

export function getPythonArtifact(platform: Platform, arch: Arch): PythonArtifact {
  const key = getPlatformKey(platform, arch)
  const triple = PYTHON_TRIPLES[key]
  const sha256 = PYTHON_SHA256[key]
  if (!triple || !sha256) throw new Error(`No bundled Python artifact for ${key}`)
  const fileName = `cpython-${PYTHON_STANDALONE_VERSION}+${PYTHON_STANDALONE_TAG}-${triple}-install_only_stripped.tar.gz`
  return {
    fileName,
    sha256,
    url: `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_TAG}/${fileName}`,
  }
}

function stampPath(targetDir: string): string {
  return join(targetDir, '.selection-runtime.json')
}

function readStamp(targetDir: string): RuntimeStamp | null {
  try {
    return JSON.parse(readFileSync(stampPath(targetDir), 'utf8')) as RuntimeStamp
  } catch {
    return null
  }
}

function writeStamp(targetDir: string, stamp: RuntimeStamp): void {
  writeFileSync(stampPath(targetDir), JSON.stringify(stamp, null, 2))
}

function stampMatches(targetDir: string, expected: RuntimeStamp): boolean {
  const stamp = readStamp(targetDir)
  return Boolean(
    stamp
    && stamp.kind === expected.kind
    && stamp.version === expected.version
    && stamp.platform === expected.platform
    && stamp.arch === expected.arch,
  )
}

function looksLikeGitRoot(root: string): boolean {
  return [
    join(root, 'bin', 'git'),
    join(root, 'cmd', 'git.exe'),
    join(root, 'mingw64', 'bin', 'git.exe'),
    join(root, 'ucrt64', 'bin', 'git.exe'),
    join(root, 'bin', 'git.exe'),
  ].some(existsSync)
}

function looksLikePythonRoot(root: string): boolean {
  return [
    join(root, 'bin', 'python3'),
    join(root, 'bin', 'python'),
    join(root, 'python.exe'),
    join(root, 'python3.exe'),
  ].some(existsSync)
}

function locateRuntimeRoot(extracted: string, predicate: (root: string) => boolean): string {
  if (predicate(extracted)) return extracted
  for (const name of readdirSync(extracted)) {
    const candidate = join(extracted, name)
    if (statSync(candidate).isDirectory() && predicate(candidate)) return candidate
  }
  throw new Error(`Could not locate a runtime root under ${extracted}`)
}

function chmodUnixTree(root: string): void {
  if (process.platform === 'win32') return
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        try { chmodSync(full, 0o755) } catch { /* ignore */ }
      }
    }
  }
  walk(root)
}

async function cachedDownload(electronDir: string, fileName: string, urls: string[], sha256: string): Promise<string> {
  const cacheDir = join(electronDir, '.cache', 'downloads')
  mkdirSync(cacheDir, { recursive: true })
  const cached = join(cacheDir, fileName)
  if (existsSync(cached) && await verifySha256(cached, sha256)) {
    console.log(`  Using cached ${cached}`)
    return cached
  }
  const tempDir = join(electronDir, '.host-runtime-download-temp')
  mkdirSync(tempDir, { recursive: true })
  const dest = join(tempDir, fileName)
  await curlDownload(dest, urls, { timeoutMs: LARGE_DOWNLOAD_TIMEOUT_MS })
  if (!(await verifySha256(dest, sha256))) {
    throw new Error(`Checksum mismatch for ${fileName}`)
  }
  copyFileSync(dest, cached)
  return cached
}

function replaceTree(source: string, destination: string): void {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, dereference: true })
}

function ensureWindowsPython3Alias(pythonRoot: string, platform: Platform): void {
  if (platform !== 'win32') return
  const python = join(pythonRoot, 'python.exe')
  const python3 = join(pythonRoot, 'python3.exe')
  if (existsSync(python) && !existsSync(python3)) {
    copyFileSync(python, python3)
  }
}

export async function downloadGit(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config
  const artifact = getGitArtifact(platform, arch)
  const targetDir = join(electronDir, 'vendor', 'git')
  const expected: RuntimeStamp = {
    kind: 'git',
    version: artifact.version,
    platform,
    arch,
  }
  if (stampMatches(targetDir, expected) && looksLikeGitRoot(targetDir)) {
    console.log(`Git ${artifact.version} already present at ${targetDir}`)
    return
  }

  console.log(`Downloading Git ${artifact.version} for ${getPlatformKey(platform, arch)}...`)
  const tempDir = join(electronDir, '.git-runtime-temp')
  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(tempDir, { recursive: true })
  try {
    const archive = await cachedDownload(electronDir, artifact.fileName, [
      artifact.url,
      `https://ghproxy.net/${artifact.url}`,
    ], artifact.sha256)
    const extractDir = join(tempDir, 'extract')
    mkdirSync(extractDir, { recursive: true })
    await extractArchive(archive, extractDir)
    const root = locateRuntimeRoot(extractDir, looksLikeGitRoot)
    replaceTree(root, targetDir)
    chmodUnixTree(targetDir)
    writeStamp(targetDir, expected)
    if (!looksLikeGitRoot(targetDir)) {
      throw new Error(`Git binary missing after extract at ${targetDir}`)
    }
    console.log(`  Git installed to ${targetDir} ✓`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export async function downloadPython(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config
  const artifact = getPythonArtifact(platform, arch)
  const targetDir = join(electronDir, 'vendor', 'python')
  const expected: RuntimeStamp = {
    kind: 'python',
    version: `${PYTHON_STANDALONE_VERSION}+${PYTHON_STANDALONE_TAG}`,
    platform,
    arch,
  }
  if (stampMatches(targetDir, expected) && looksLikePythonRoot(targetDir)) {
    console.log(`Python ${expected.version} already present at ${targetDir}`)
    return
  }

  console.log(`Downloading Python ${expected.version} for ${getPlatformKey(platform, arch)}...`)
  const tempDir = join(electronDir, '.python-runtime-temp')
  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(tempDir, { recursive: true })
  try {
    const archive = await cachedDownload(electronDir, artifact.fileName, [
      artifact.url,
      `https://ghproxy.net/${artifact.url}`,
    ], artifact.sha256)
    const extractDir = join(tempDir, 'extract')
    mkdirSync(extractDir, { recursive: true })
    await extractArchive(archive, extractDir)
    const root = locateRuntimeRoot(extractDir, looksLikePythonRoot)
    replaceTree(root, targetDir)
    ensureWindowsPython3Alias(targetDir, platform)
    chmodUnixTree(targetDir)
    writeStamp(targetDir, expected)
    if (!looksLikePythonRoot(targetDir)) {
      throw new Error(`Python binary missing after extract at ${targetDir}`)
    }
    console.log(`  Python installed to ${targetDir} ✓`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function bundleRuntimePlatform(config: Pick<BuildConfig, 'platform' | 'arch'>): void {
  process.env.SELECTION_BUNDLE_PLATFORM = config.platform
  process.env.SELECTION_BUNDLE_ARCH = config.arch
}

export function resolveBundleConfig(base: Omit<BuildConfig, 'platform' | 'arch'>): BuildConfig {
  const platform = (process.env.SELECTION_BUNDLE_PLATFORM as Platform | undefined)
    ?? (process.platform as Platform)
  const arch = (process.env.SELECTION_BUNDLE_ARCH as Arch | undefined)
    ?? (process.arch as Arch)
  return { ...base, platform, arch }
}

export function hasHostRuntimeArtifacts(platform: Platform, arch: Arch): boolean {
  const key = getPlatformKey(platform, arch)
  return Boolean(GIT_ARTIFACTS[key] && PYTHON_TRIPLES[key] && PYTHON_SHA256[key])
}

/** Fail closed: packaging a desktop installer must ship both runtimes. */
export async function downloadHostRuntimes(config: BuildConfig): Promise<void> {
  if (!hasHostRuntimeArtifacts(config.platform, config.arch)) {
    throw new Error(`No bundled Git/Python artifacts for ${getPlatformKey(config.platform, config.arch)}`)
  }
  await downloadGit(config)
  await downloadPython(config)
}

/** Dev/`electron:build` on unsupported arches keep using system Git/Python. */
export async function downloadHostRuntimesIfSupported(config: BuildConfig): Promise<void> {
  if (!hasHostRuntimeArtifacts(config.platform, config.arch)) {
    console.warn(`Skipping bundled Git/Python; no artifacts for ${getPlatformKey(config.platform, config.arch)}`)
    return
  }
  await downloadGit(config)
  await downloadPython(config)
}
