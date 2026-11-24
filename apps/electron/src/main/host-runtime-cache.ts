import { execFile } from 'node:child_process'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync,
} from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  ARCHIVE_MANIFEST_FORMAT, RUNTIME_STAMP_FILE, hostRuntimeArchiveDirectory, sha256File, systemTar,
} from './host-runtime-archive.cjs'

type RuntimeKind = 'git' | 'python'

interface RuntimeStamp {
  kind: RuntimeKind
  version: string
  platform: string
  arch: string
  treeFormat: number
}

interface RuntimeManifest {
  format: number
  stamp: RuntimeStamp
  archiveSha256: string
  checks: { path: string; sha256: string }[]
}

const runFile = promisify(execFile)
const sha256Pattern = /^[a-f0-9]{64}$/

function readManifest(file: string, kind: RuntimeKind, platform: string, arch: string): RuntimeManifest {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as RuntimeManifest
  const stamp = manifest?.stamp
  if (manifest?.format !== ARCHIVE_MANIFEST_FORMAT
    || stamp?.kind !== kind || stamp.platform !== platform || stamp.arch !== arch
    || typeof stamp.version !== 'string' || !/^[a-z0-9][a-z0-9.+_-]{0,79}$/i.test(stamp.version)
    || !Number.isSafeInteger(stamp.treeFormat) || stamp.treeFormat < 1
    || !sha256Pattern.test(manifest.archiveSha256)
    || !Array.isArray(manifest.checks) || manifest.checks.length === 0
    || !manifest.checks.every(check => typeof check?.path === 'string'
      && check.path.split('/').every(part => /^[a-z0-9_-][a-z0-9._+-]*$/i.test(part))
      && sha256Pattern.test(check.sha256))) {
    throw new Error(`Invalid ${kind} runtime manifest for ${platform}-${arch}`)
  }
  return manifest
}

function isUsableRuntime(root: string, manifest: RuntimeManifest): boolean {
  try {
    if (!lstatSync(root).isDirectory()) return false
    const actual = JSON.parse(readFileSync(join(root, RUNTIME_STAMP_FILE), 'utf8')) as RuntimeStamp
    const expected = manifest.stamp
    if (actual.kind !== expected.kind || actual.version !== expected.version || actual.treeFormat !== expected.treeFormat
      || actual.platform !== expected.platform || actual.arch !== expected.arch) return false
    const realRoot = realpathSync(root)
    return manifest.checks.every(check => {
      const file = realpathSync(join(root, check.path))
      const rel = relative(realRoot, file)
      return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
        && statSync(file).isFile() && sha256File(file) === check.sha256
    })
  } catch {
    return false
  }
}

async function provisionRuntime(archiveDir: string, cacheRoot: string, kind: RuntimeKind): Promise<string> {
  const { platform, arch } = process
  const manifest = readManifest(join(archiveDir, `${kind}.json`), kind, platform, arch)
  const destination = join(cacheRoot, `${platform}-${arch}`, kind, `${manifest.stamp.version}-${manifest.stamp.treeFormat}`)
  if (isUsableRuntime(destination, manifest)) return destination

  const archive = join(archiveDir, `${kind}.tar.gz`)
  if (sha256File(archive) !== manifest.archiveSha256) throw new Error(`Bundled ${kind} archive failed its SHA-256 check`)

  // Stage on the same volume so a crash during extraction never publishes a partial tree.
  const parent = join(cacheRoot, `${platform}-${arch}`, kind)
  mkdirSync(parent, { recursive: true })
  const temp = mkdtempSync(join(parent, '.install-'))
  const staging = join(temp, 'runtime')
  const previous = join(temp, 'previous')
  mkdirSync(staging)
  try {
    await runFile(systemTar(), ['-xzf', archive, '-C', staging], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      windowsHide: true,
      timeout: 120_000,
    })
    if (!isUsableRuntime(staging, manifest)) throw new Error(`Extracted ${kind} runtime is incomplete`)

    // A second process may have completed the install while we were extracting.
    if (isUsableRuntime(destination, manifest)) return destination
    if (existsSync(destination)) renameSync(destination, previous)
    try {
      renameSync(staging, destination)
    } catch (error) {
      if (isUsableRuntime(destination, manifest)) return destination
      if (existsSync(previous) && !existsSync(destination)) renameSync(previous, destination)
      throw error
    }
    return destination
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

export async function prepareDesktopHostRuntimes(
  resourcesBase: string,
  cacheRoot: string,
  onError: (kind: RuntimeKind, error: unknown) => void,
): Promise<Partial<Record<RuntimeKind, string>>> {
  const archiveDir = hostRuntimeArchiveDirectory(resourcesBase)
  if (!existsSync(archiveDir)) return {}
  const roots: Partial<Record<RuntimeKind, string>> = {}
  // Provision each independently so damage to one archive does not disable the other tool.
  for (const kind of ['git', 'python'] as const) {
    try {
      roots[kind] = await provisionRuntime(archiveDir, cacheRoot, kind)
    } catch (error) {
      onError(kind, error)
    }
  }
  return roots
}
