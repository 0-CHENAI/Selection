import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { delimiter as hostDelimiter, join } from 'node:path'

export const HOST_PYTHON_VERSION = '3.12'
export const USER_PYTHON_VENV = 'python-venv'
export const USER_PYTHON_SITE = 'python-user'

export type HostToolSource = 'bundled' | 'system' | 'missing'

export interface ResolveHostToolsOptions {
  resourcesBase: string
  userDataDir?: string
  preferSystemGit?: boolean
  preferSystemPython?: boolean
  platform?: NodeJS.Platform
  pathEnv?: string
  exists?: (path: string) => boolean
  hasXcodeClt?: () => boolean
}

export interface ResolvedHostTools {
  gitBinary: string | null
  gitBash: string | null
  gitExecPath: string | null
  gitTemplateDir: string | null
  gitSslCAInfo: string | null
  gitSource: HostToolSource
  pythonBinary: string | null
  python3Binary: string | null
  pythonSource: HostToolSource
  pathPrepend: string[]
  venvDir: string | null
  pythonUserBase: string | null
}

const DARWIN_CLT_STUBS = new Set([
  '/usr/bin/git',
  '/usr/bin/python',
  '/usr/bin/python3',
  '/usr/bin/pip',
  '/usr/bin/pip3',
])

function defaultHasXcodeClt(): boolean {
  if (process.platform !== 'darwin') return true
  try {
    execFileSync('xcode-select', ['-p'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** True when `absPath` is the macOS CLT trampoline that pops an install dialog. */
export function isMacosCltStub(
  absPath: string,
  opts?: { platform?: string; hasXcodeClt?: () => boolean },
): boolean {
  const platform = opts?.platform ?? process.platform
  if (platform !== 'darwin') return false
  const normalized = absPath.replace(/\/+$/, '')
  if (!DARWIN_CLT_STUBS.has(normalized)) return false
  const hasClt = opts?.hasXcodeClt ?? defaultHasXcodeClt
  return !hasClt()
}

export function vendorGitRoot(resourcesBase: string): string {
  return join(resourcesBase, 'vendor', 'git')
}

export function vendorPythonRoot(resourcesBase: string): string {
  return join(resourcesBase, 'vendor', 'python')
}

function firstExisting(exists: (path: string) => boolean, paths: string[]): string | null {
  for (const candidate of paths) {
    if (candidate && exists(candidate)) return candidate
  }
  return null
}

export function findBundledGitBinary(
  gitRoot: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const names = platform === 'win32'
    ? ['cmd/git.exe', 'mingw64/bin/git.exe', 'ucrt64/bin/git.exe', 'bin/git.exe']
    : ['bin/git']
  return firstExisting(exists, names.map(name => join(gitRoot, name)))
}

export function findBundledGitBash(
  gitRoot: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  return firstExisting(exists, [
    join(gitRoot, 'bin', 'bash.exe'),
    join(gitRoot, 'usr', 'bin', 'bash.exe'),
  ])
}

export function findGitExecPath(
  gitRoot: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const dirs = platform === 'win32'
    ? ['mingw64/libexec/git-core', 'ucrt64/libexec/git-core']
    : ['libexec/git-core']
  return firstExisting(exists, dirs.map(name => join(gitRoot, name)))
}

export function findGitTemplateDir(
  gitRoot: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  return firstExisting(exists, [
    join(gitRoot, 'share', 'git-core', 'templates'),
    join(gitRoot, 'mingw64', 'share', 'git-core', 'templates'),
    join(gitRoot, 'ucrt64', 'share', 'git-core', 'templates'),
    join(gitRoot, 'usr', 'share', 'git-core', 'templates'),
  ])
}

export function findGitSslCAInfo(
  gitRoot: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  return firstExisting(exists, [
    join(gitRoot, 'mingw64', 'ssl', 'certs', 'ca-bundle.crt'),
    join(gitRoot, 'ucrt64', 'ssl', 'certs', 'ca-bundle.crt'),
    join(gitRoot, 'mingw64', 'etc', 'ssl', 'certs', 'ca-bundle.crt'),
    join(gitRoot, 'etc', 'ssl', 'certs', 'ca-bundle.crt'),
    join(gitRoot, 'ssl', 'certs', 'ca-bundle.crt'),
  ])
}

export function gitPathDirs(
  gitRoot: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const relative = platform === 'win32'
    ? ['cmd', 'usr/bin', 'bin', 'mingw64/bin', 'ucrt64/bin']
    : ['bin']
  return relative.map(name => join(gitRoot, name)).filter(exists)
}

export function findBundledPythonBinary(
  pythonRoot: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const names = platform === 'win32'
    ? ['python.exe', 'python3.exe']
    : ['bin/python3', 'bin/python']
  return firstExisting(exists, names.map(name => join(pythonRoot, name)))
}

export function pythonPathDirs(
  pythonRoot: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): string[] {
  if (platform === 'win32') {
    return [pythonRoot, join(pythonRoot, 'Scripts')].filter(exists)
  }
  return [join(pythonRoot, 'bin')].filter(exists)
}

export function venvPathDirs(
  venvDir: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): string[] {
  if (platform === 'win32') {
    return [join(venvDir, 'Scripts')].filter(exists)
  }
  return [join(venvDir, 'bin')].filter(exists)
}

function whichOnPath(
  name: string,
  pathEnv: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
): string | null {
  const sep = platform === 'win32' ? ';' : ':'
  const extensions = platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

function usableSystemBinary(
  path: string | null,
  opts: { platform: NodeJS.Platform; hasXcodeClt: () => boolean },
): string | null {
  if (!path) return null
  if (isMacosCltStub(path, opts)) return null
  return path
}

export function resolveHostTools(options: ResolveHostToolsOptions): ResolvedHostTools {
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? existsSync
  const hasXcodeClt = options.hasXcodeClt ?? defaultHasXcodeClt
  const pathEnv = options.pathEnv ?? process.env.PATH ?? ''
  const preferSystemGit = options.preferSystemGit === true
    || process.env.CRAFT_PREFER_SYSTEM_GIT === '1'
  const preferSystemPython = options.preferSystemPython === true
    || process.env.CRAFT_PREFER_SYSTEM_PYTHON === '1'
  const gitRoot = vendorGitRoot(options.resourcesBase)
  const pythonRoot = vendorPythonRoot(options.resourcesBase)
  const stubOpts = { platform, hasXcodeClt }

  const bundledGit = findBundledGitBinary(gitRoot, platform, exists)
  const bundledBash = findBundledGitBash(gitRoot, exists)
  const systemGit = usableSystemBinary(whichOnPath('git', pathEnv, platform, exists), stubOpts)
  const systemBash = platform === 'win32'
    ? firstExisting(exists, [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
    ].filter(Boolean))
    : null

  let gitBinary: string | null = null
  let gitSource: HostToolSource = 'missing'
  let gitDirs: string[] = []
  let gitBash = bundledBash
  let gitExecPath: string | null = null
  let gitTemplateDir: string | null = null
  let gitSslCAInfo: string | null = null

  const useSystemGit = (preferSystemGit && systemGit) || (!bundledGit && systemGit)
  if (useSystemGit && systemGit) {
    gitBinary = systemGit
    gitSource = 'system'
    gitBash = (preferSystemGit && systemBash) || bundledBash || systemBash
  } else if (bundledGit) {
    gitBinary = bundledGit
    gitSource = 'bundled'
    gitDirs = gitPathDirs(gitRoot, platform, exists)
    gitExecPath = findGitExecPath(gitRoot, platform, exists)
    gitTemplateDir = findGitTemplateDir(gitRoot, exists)
    gitSslCAInfo = findGitSslCAInfo(gitRoot, exists)
    gitBash = bundledBash || systemBash
  }

  const bundledPython = findBundledPythonBinary(pythonRoot, platform, exists)
  const systemPython = usableSystemBinary(
    whichOnPath('python3', pathEnv, platform, exists)
      ?? whichOnPath('python', pathEnv, platform, exists),
    stubOpts,
  )

  let pythonBinary: string | null = null
  let pythonSource: HostToolSource = 'missing'
  let pythonDirs: string[] = []
  const useSystemPython = (preferSystemPython && systemPython) || (!bundledPython && systemPython)
  if (useSystemPython && systemPython) {
    pythonBinary = systemPython
    pythonSource = 'system'
  } else if (bundledPython) {
    pythonBinary = bundledPython
    pythonSource = 'bundled'
    pythonDirs = pythonPathDirs(pythonRoot, platform, exists)
  }

  const venvDir = options.userDataDir ? join(options.userDataDir, USER_PYTHON_VENV) : null
  const pythonUserBase = options.userDataDir ? join(options.userDataDir, USER_PYTHON_SITE) : null
  const venvDirs = venvDir && pythonSource === 'bundled' ? venvPathDirs(venvDir, platform, exists) : []

  const python3Binary = pythonBinary && /python3(\.exe)?$/i.test(pythonBinary)
    ? pythonBinary
    : pythonBinary && platform === 'win32'
      ? firstExisting(exists, [join(pythonRoot, 'python3.exe')]) ?? pythonBinary
      : pythonBinary

  return {
    gitBinary,
    gitBash,
    gitExecPath,
    gitTemplateDir,
    gitSslCAInfo,
    gitSource,
    pythonBinary,
    python3Binary,
    pythonSource,
    pathPrepend: [...venvDirs, ...pythonDirs, ...gitDirs],
    venvDir: pythonSource === 'bundled' ? venvDir : null,
    pythonUserBase: pythonSource === 'bundled' ? pythonUserBase : null,
  }
}

export function hostToolsEnv(tools: ResolvedHostTools): Record<string, string> {
  const env: Record<string, string> = {
    APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
  if (tools.gitBinary) env.CRAFT_GIT = tools.gitBinary
  if (tools.gitBash) {
    env.CRAFT_GIT_BASH = tools.gitBash
    env.CLAUDE_CODE_GIT_BASH_PATH = tools.gitBash
  }
  if (tools.gitExecPath) env.GIT_EXEC_PATH = tools.gitExecPath
  if (tools.gitTemplateDir) env.GIT_TEMPLATE_DIR = tools.gitTemplateDir
  if (tools.gitSslCAInfo) env.GIT_SSL_CAINFO = tools.gitSslCAInfo
  if (tools.pythonBinary) {
    env.CRAFT_PYTHON = tools.pythonBinary
    env.UV_PYTHON = tools.pythonBinary
    env.UV_PYTHON_DOWNLOADS = 'never'
  }
  if (tools.python3Binary) env.CRAFT_PYTHON3 = tools.python3Binary
  if (tools.pythonUserBase) env.PYTHONUSERBASE = tools.pythonUserBase
  return env
}

export function prependPath(
  current: string | undefined,
  dirs: string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const sep = platform === 'win32' ? ';' : hostDelimiter
  const existing = (current ?? '').split(sep).filter(Boolean)
  const seen = new Set(existing.map(dir => dir.toLowerCase()))
  const prefix: string[] = []
  for (const dir of dirs) {
    if (!dir) continue
    const key = dir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    prefix.push(dir)
  }
  return [...prefix, ...existing].join(sep)
}

export function applyHostTools(tools: ResolvedHostTools, env: NodeJS.ProcessEnv = process.env): void {
  env.PATH = prependPath(env.PATH, tools.pathPrepend)
  Object.assign(env, hostToolsEnv(tools))
  // Keep `uv run` ephemeral: a user-activated venv must not shadow the bundled interpreter.
  if (tools.pythonSource === 'bundled') delete env.VIRTUAL_ENV
}

export function venvPythonPath(venvDir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python')
}

/** Create an isolated venv under userData using the bundled interpreter. Offline-safe. */
export function ensureUserPythonVenv(
  pythonBinary: string,
  venvDir: string,
  uvBinary: string | null = process.env.CRAFT_UV ?? null,
): boolean {
  const pythonInVenv = venvPythonPath(venvDir)
  if (existsSync(pythonInVenv)) return true
  mkdirSync(venvDir, { recursive: true })
  const env = {
    ...process.env,
    UV_PYTHON: pythonBinary,
    UV_PYTHON_DOWNLOADS: 'never',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  }
  try {
    if (uvBinary && existsSync(uvBinary)) {
      execFileSync(uvBinary, ['venv', '--python', pythonBinary, venvDir], {
        stdio: 'ignore',
        timeout: 120_000,
        env,
      })
    } else {
      execFileSync(pythonBinary, ['-m', 'venv', venvDir], {
        stdio: 'ignore',
        timeout: 120_000,
        env,
      })
    }
    return existsSync(pythonInVenv)
  } catch {
    return false
  }
}
