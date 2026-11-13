import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import {
  applyHostTools,
  findBundledGitBinary,
  hostToolsEnv,
  isMacosCltStub,
  prependPath,
  resolveHostTools,
  vendorGitRoot,
  vendorPythonRoot,
  venvPythonPath,
} from './host-tools.ts'

describe('isMacosCltStub', () => {
  it('treats /usr/bin/git as a stub when CLT is missing', () => {
    expect(isMacosCltStub('/usr/bin/git', { platform: 'darwin', hasXcodeClt: () => false })).toBe(true)
    expect(isMacosCltStub('/usr/bin/python3', { platform: 'darwin', hasXcodeClt: () => false })).toBe(true)
  })

  it('allows /usr/bin/git when CLT is installed', () => {
    expect(isMacosCltStub('/usr/bin/git', { platform: 'darwin', hasXcodeClt: () => true })).toBe(false)
  })

  it('never treats Homebrew or bundled paths as stubs', () => {
    expect(isMacosCltStub('/opt/homebrew/bin/git', { platform: 'darwin', hasXcodeClt: () => false })).toBe(false)
    expect(isMacosCltStub('/usr/bin/git', { platform: 'win32', hasXcodeClt: () => false })).toBe(false)
  })
})

describe('resolveHostTools', () => {
  const resourcesBase = '/app'
  const gitRoot = vendorGitRoot(resourcesBase)
  const pythonRoot = vendorPythonRoot(resourcesBase)
  const bundledGit = join(gitRoot, 'bin', 'git')
  const bundledPython = join(pythonRoot, 'bin', 'python3')
  const systemGit = '/opt/homebrew/bin/git'
  const stubGit = '/usr/bin/git'
  const stubPython = '/usr/bin/python3'

  const files = new Set([
    bundledGit,
    bundledPython,
    join(gitRoot, 'bin'),
    join(pythonRoot, 'bin'),
    join(gitRoot, 'libexec', 'git-core'),
    join(gitRoot, 'share', 'git-core', 'templates'),
    systemGit,
    stubGit,
    stubPython,
    '/opt/homebrew/bin/python3',
  ])

  const exists = (path: string) => files.has(path)

  it('prefers bundled git and python and prepends their bin dirs', () => {
    const tools = resolveHostTools({
      resourcesBase,
      platform: 'darwin',
      pathEnv: '/usr/bin:/opt/homebrew/bin',
      exists,
      hasXcodeClt: () => false,
    })
    expect(tools.gitSource).toBe('bundled')
    expect(tools.gitBinary).toBe(bundledGit)
    expect(tools.pythonSource).toBe('bundled')
    expect(tools.pythonBinary).toBe(bundledPython)
    expect(tools.pathPrepend[0]).toBe(join(pythonRoot, 'bin'))
    expect(tools.pathPrepend).toContain(join(gitRoot, 'bin'))
    expect(tools.gitExecPath).toBe(join(gitRoot, 'libexec', 'git-core'))
  })

  it('does not fall back to macOS CLT stubs', () => {
    const tools = resolveHostTools({
      resourcesBase: '/empty',
      platform: 'darwin',
      pathEnv: '/usr/bin',
      exists: (path: string) => path === stubGit || path === stubPython || path === '/usr/bin',
      hasXcodeClt: () => false,
    })
    expect(tools.gitSource).toBe('missing')
    expect(tools.pythonSource).toBe('missing')
    expect(tools.gitBinary).toBeNull()
    expect(tools.pythonBinary).toBeNull()
  })

  it('uses a real system git when bundled is missing', () => {
    const tools = resolveHostTools({
      resourcesBase: '/empty',
      platform: 'darwin',
      pathEnv: '/opt/homebrew/bin:/usr/bin',
      exists: (path: string) => path === systemGit || path === '/opt/homebrew/bin',
      hasXcodeClt: () => false,
    })
    expect(tools.gitSource).toBe('system')
    expect(tools.gitBinary).toBe(systemGit)
    expect(tools.pathPrepend).toEqual([])
  })

  it('honors preferSystemGit when a non-stub git is on PATH', () => {
    const tools = resolveHostTools({
      resourcesBase,
      preferSystemGit: true,
      platform: 'darwin',
      pathEnv: '/opt/homebrew/bin:/usr/bin',
      exists,
      hasXcodeClt: () => false,
    })
    expect(tools.gitSource).toBe('system')
    expect(tools.gitBinary).toBe(systemGit)
    expect(tools.pathPrepend).not.toContain(join(gitRoot, 'bin'))
  })

  it('keeps bundled python even if preferSystemPython points at a stub', () => {
    const tools = resolveHostTools({
      resourcesBase,
      preferSystemPython: true,
      platform: 'darwin',
      pathEnv: '/usr/bin',
      exists,
      hasXcodeClt: () => false,
    })
    expect(tools.pythonSource).toBe('bundled')
    expect(tools.pythonBinary).toBe(bundledPython)
  })

  it('resolves Windows Git Bash and git.exe under cmd/', () => {
    const winGit = join(gitRoot, 'cmd', 'git.exe')
    const winBash = join(gitRoot, 'bin', 'bash.exe')
    const winPython = join(pythonRoot, 'python.exe')
    const winFiles = new Set([
      winGit, winBash, winPython,
      join(gitRoot, 'cmd'), join(gitRoot, 'bin'), join(gitRoot, 'usr', 'bin'),
      pythonRoot, join(pythonRoot, 'Scripts'),
    ])
    const tools = resolveHostTools({
      resourcesBase,
      platform: 'win32',
      pathEnv: 'C:\\Windows\\System32',
      exists: (path: string) => winFiles.has(path),
      hasXcodeClt: () => true,
    })
    expect(tools.gitBinary).toBe(winGit)
    expect(tools.gitBash).toBe(winBash)
    expect(tools.pythonBinary).toBe(winPython)
    expect(tools.pathPrepend).toContain(join(gitRoot, 'cmd'))
    expect(tools.pathPrepend).toContain(pythonRoot)
  })

  it('includes an existing userData venv bin ahead of bundled python', () => {
    const venvBin = join('/data', 'python-venv', 'bin')
    const withVenv = (path: string) => exists(path) || path === venvBin
    const tools = resolveHostTools({
      resourcesBase,
      userDataDir: '/data',
      platform: 'darwin',
      pathEnv: '/usr/bin',
      exists: withVenv,
      hasXcodeClt: () => false,
    })
    expect(tools.pathPrepend[0]).toBe(venvBin)
    expect(tools.pythonUserBase).toBe(join('/data', 'python-user'))
  })
})

describe('hostToolsEnv and PATH', () => {
  it('sets UV_PYTHON_DOWNLOADS=never and does not set VIRTUAL_ENV', () => {
    const env = hostToolsEnv({
      gitBinary: '/app/vendor/git/bin/git',
      gitBash: 'C:\\git\\bin\\bash.exe',
      gitExecPath: '/app/vendor/git/libexec/git-core',
      gitTemplateDir: null,
      gitSslCAInfo: null,
      gitSource: 'bundled',
      pythonBinary: '/app/vendor/python/bin/python3',
      python3Binary: '/app/vendor/python/bin/python3',
      pythonSource: 'bundled',
      pathPrepend: ['/app/vendor/python/bin'],
      venvDir: '/data/python-venv',
      pythonUserBase: '/data/python-user',
    })
    expect(env.UV_PYTHON).toBe('/app/vendor/python/bin/python3')
    expect(env.UV_PYTHON_DOWNLOADS).toBe('never')
    expect(env.CRAFT_GIT).toBe('/app/vendor/git/bin/git')
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe('C:\\git\\bin\\bash.exe')
    expect(env.PYTHONUSERBASE).toBe('/data/python-user')
    expect(env.VIRTUAL_ENV).toBeUndefined()
    expect(env.APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP).toBe('1')
  })

  it('prepends bundled dirs in front of /usr/bin', () => {
    expect(prependPath('/usr/bin:/bin', ['/app/vendor/git/bin', '/usr/bin'], 'darwin'))
      .toBe('/app/vendor/git/bin:/usr/bin:/bin')
  })

  it('keeps PATH entries that contain spaces', () => {
    const vendor = '/Applications/Selection Swarm Preview.app/Contents/Resources/app/vendor/git/bin'
    expect(prependPath('/usr/bin', [vendor], 'darwin'))
      .toBe(`${vendor}:/usr/bin`)
    expect(prependPath('C:\\Windows\\System32', ['C:\\Program Files\\Selection\\vendor\\git\\cmd'], 'win32'))
      .toBe('C:\\Program Files\\Selection\\vendor\\git\\cmd;C:\\Windows\\System32')
  })

  it('applies PATH and env onto a target object', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', VIRTUAL_ENV: '/tmp/venv' }
    applyHostTools({
      gitBinary: '/app/vendor/git/bin/git',
      gitBash: null,
      gitExecPath: null,
      gitTemplateDir: null,
      gitSslCAInfo: null,
      gitSource: 'bundled',
      pythonBinary: '/app/vendor/python/bin/python3',
      python3Binary: '/app/vendor/python/bin/python3',
      pythonSource: 'bundled',
      pathPrepend: ['/app/vendor/python/bin', '/app/vendor/git/bin'],
      venvDir: null,
      pythonUserBase: null,
    }, env)
    expect(env.PATH?.startsWith('/app/vendor/python/bin:')).toBe(true)
    expect(env.CRAFT_GIT).toBe('/app/vendor/git/bin/git')
    expect(env.UV_PYTHON_DOWNLOADS).toBe('never')
    expect(env.VIRTUAL_ENV).toBeUndefined()
  })
})

describe('venvPythonPath', () => {
  it('resolves Scripts/python.exe on Windows and bin/python elsewhere', () => {
    expect(venvPythonPath('/data/python-venv', 'win32')).toBe(join('/data/python-venv', 'Scripts', 'python.exe'))
    expect(venvPythonPath('/data/python-venv', 'darwin')).toBe(join('/data/python-venv', 'bin', 'python'))
  })
})

describe('findBundledGitBinary', () => {
  it('prefers cmd/git.exe on Windows Git for Windows layouts', () => {
    const root = 'C:/vendor/git'
    const exists = (path: string) => path === join(root, 'cmd', 'git.exe')
    expect(findBundledGitBinary(root, 'win32', exists)).toBe(join(root, 'cmd', 'git.exe'))
  })
})
