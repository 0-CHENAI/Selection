import { describe, expect, it } from 'bun:test'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DUGITE_NATIVE_VERSION,
  GIT_FOR_WINDOWS_VERSION,
  HOST_RUNTIME_TREE_FORMAT,
  PYTHON_STANDALONE_TAG,
  PYTHON_STANDALONE_VERSION,
  copyRuntimeTree,
  getGitArtifact,
  getPythonArtifact,
  hasHostRuntimeArtifacts,
  replaceTree,
  resolveBundleConfig,
  shouldPreserveRuntimeSymlinks,
  stampMatches,
} from './host-runtimes.ts'

const repoRoot = join(import.meta.dir, '../..')

describe('bundled host runtime artifacts', () => {
  it('maps desktop targets to pinned Git downloads', () => {
    const mac = getGitArtifact('darwin', 'arm64')
    expect(mac.fileName).toContain('macOS-arm64.tar.gz')
    expect(mac.url).toContain(`releases/download/${DUGITE_NATIVE_VERSION}/`)
    expect(mac.sha256).toHaveLength(64)

    const intel = getGitArtifact('darwin', 'x64')
    expect(intel.fileName).toContain('macOS-x64.tar.gz')

    const win = getGitArtifact('win32', 'x64')
    expect(win.fileName).toBe('Git-2.56.1-64-bit.tar.bz2')
    expect(win.url).toContain(GIT_FOR_WINDOWS_VERSION)
    expect(win.sha256).toBe('d7d89e69855f00e73d957b513c49538a420c465c84b9d212cf1add400eecdf54')
  })

  it('maps desktop targets to python-build-standalone 3.12 install_only_stripped', () => {
    const mac = getPythonArtifact('darwin', 'arm64')
    expect(mac.fileName).toBe(
      `cpython-${PYTHON_STANDALONE_VERSION}+${PYTHON_STANDALONE_TAG}-aarch64-apple-darwin-install_only_stripped.tar.gz`,
    )
    expect(mac.url).toContain(`/download/${PYTHON_STANDALONE_TAG}/`)
    expect(mac.sha256).toHaveLength(64)

    const win = getPythonArtifact('win32', 'x64')
    expect(win.fileName).toContain('x86_64-pc-windows-msvc-install_only_stripped')
  })

  it('rejects unsupported targets', () => {
    expect(() => getGitArtifact('win32', 'arm64')).toThrow('win32-arm64')
    expect(() => getPythonArtifact('linux', 'arm64')).toThrow('linux-arm64')
    expect(hasHostRuntimeArtifacts('darwin', 'arm64')).toBe(true)
    expect(hasHostRuntimeArtifacts('win32', 'x64')).toBe(true)
    expect(hasHostRuntimeArtifacts('linux', 'arm64')).toBe(false)
  })

  it('honors SELECTION_BUNDLE_PLATFORM for cross-compiles', () => {
    const previousPlatform = process.env.SELECTION_BUNDLE_PLATFORM
    const previousArch = process.env.SELECTION_BUNDLE_ARCH
    process.env.SELECTION_BUNDLE_PLATFORM = 'win32'
    process.env.SELECTION_BUNDLE_ARCH = 'x64'
    try {
      const config = resolveBundleConfig({
        upload: false,
        uploadLatest: false,
        uploadScript: false,
        rootDir: repoRoot,
        electronDir: join(repoRoot, 'apps/electron'),
      })
      expect(config.platform).toBe('win32')
      expect(config.arch).toBe('x64')
    } finally {
      if (previousPlatform === undefined) delete process.env.SELECTION_BUNDLE_PLATFORM
      else process.env.SELECTION_BUNDLE_PLATFORM = previousPlatform
      if (previousArch === undefined) delete process.env.SELECTION_BUNDLE_ARCH
      else process.env.SELECTION_BUNDLE_ARCH = previousArch
    }
  })

  it('packages vendor git/python via extraResources and afterPack', () => {
    const builder = readFileSync(join(repoRoot, 'apps/electron/electron-builder.yml'), 'utf8')
    const filesIncludes = builder.split('\n').filter((line) =>
      /^\s+- vendor\/(?:git|python)/.test(line) && !line.includes('!'),
    )
    expect(filesIncludes).toEqual([])
    expect(builder).toContain('from: vendor/git')
    expect(builder).toContain('to: app/vendor/git')
    expect(builder).toContain('from: vendor/python')
    expect(builder).toContain('to: app/vendor/python')
    expect(builder).toContain('!vendor/git/**/*')
    expect(builder).toContain('!vendor/python/**/*')
    expect(builder).toMatch(/^asar: false$/m)
    expect(builder).toContain('asarUnpack:')
    expect(builder).toContain('- vendor/**')

    const afterPack = readFileSync(join(repoRoot, 'apps/electron/scripts/afterPack.cjs'), 'utf8')
    expect(afterPack).toContain('vendor/git')
    expect(afterPack).toContain('vendor/python')
    expect(afterPack).toContain('copyRuntimeTree')
    expect(afterPack).toContain('shouldPreserveRuntimeSymlinks')
    expect(afterPack).not.toMatch(/copyHostRuntime[\s\S]{0,400}dereference:\s*true/)
  })

  it('wires Git/Python downloads into package, copy-assets, electron-dev, and main PATH', () => {
    const pkg = readFileSync(join(repoRoot, 'scripts/package-desktop.ts'), 'utf8')
    expect(pkg).toContain('bundleRuntimePlatform(config)')
    expect(pkg).toContain('downloadHostRuntimes(config)')

    const copy = readFileSync(join(repoRoot, 'apps/electron/scripts/copy-assets.ts'), 'utf8')
    expect(copy).toContain('resolveBundleConfig')
    expect(copy).toContain('downloadHostRuntimesIfSupported')

    const dev = readFileSync(join(repoRoot, 'scripts/electron-dev.ts'), 'utf8')
    expect(dev).toContain('downloadHostRuntimesIfSupported')

    const main = readFileSync(join(repoRoot, 'apps/electron/src/main/index.ts'), 'utf8')
    expect(main).toContain('applyHostTools')
    expect(main).toContain('ensureUserPythonVenv')
    expect(main).toContain('UV_PYTHON_DOWNLOADS=never')

    const serverBuild = readFileSync(join(repoRoot, 'scripts/build-server.ts'), 'utf8')
    expect(serverBuild).toContain('downloadHostRuntimesForServer')
    expect(serverBuild).toContain('$ROOT/vendor/git/bin')
    expect(serverBuild).toContain('$ROOT/vendor/python/bin')

    const serverIndex = readFileSync(join(repoRoot, 'packages/server/src/index.ts'), 'utf8')
    expect(serverIndex).toContain('applyHostTools')
    expect(serverIndex).toContain('ensureUserPythonVenv')
  })

  it('quotes uv wrappers so UV_PYTHON paths with spaces stay intact', () => {
    const binDir = join(repoRoot, 'apps/electron/resources/bin')
    for (const name of ['markitdown', 'pdf-tool', 'img-tool', 'doc-diff', 'ical-tool']) {
      const sh = readFileSync(join(binDir, name), 'utf8')
      expect(sh).toContain('PYTHON="${UV_PYTHON:-3.12}"')
      expect(sh).toContain('exec "$CRAFT_UV" run --python "$PYTHON"')
      const cmd = readFileSync(join(binDir, `${name}.cmd`), 'utf8')
      expect(cmd).toContain('if defined UV_PYTHON')
      expect(cmd).toContain('"%CRAFT_UV%" run --python "%UV_PYTHON%"')
    }
  })

  it('redirects isolated-shell pip writes away from userData PYTHONUSERBASE', () => {
    const darwin = readFileSync(join(repoRoot, 'packages/shared/src/utils/isolated-shell.ts'), 'utf8')
    expect(darwin).toContain('withIsolatedPythonHome')
    const windows = readFileSync(join(repoRoot, 'packages/shared/src/utils/windows-isolated-shell.ts'), 'utf8')
    expect(windows).toContain('withIsolatedPythonHome')
    const sandbox = readFileSync(join(repoRoot, 'packages/session-tools-core/src/runtime/sandbox-env.ts'), 'utf8')
    expect(sandbox).toContain('env.PYTHONUSERBASE = join(dataDir, \'python-user\')')
  })

  it('ships Git GPL and Python PSF license files', () => {
    const notice = readFileSync(join(repoRoot, 'apps/electron/resources/licenses/NOTICE.txt'), 'utf8')
    expect(notice).toContain('GNU General Public License v2')
    expect(notice).toContain('Python Software Foundation')
    const gitCopying = readFileSync(join(repoRoot, 'apps/electron/resources/licenses/git/COPYING'), 'utf8')
    expect(gitCopying).toContain('GNU GENERAL PUBLIC LICENSE')
    const pythonLicense = readFileSync(join(repoRoot, 'apps/electron/resources/licenses/python/LICENSE'), 'utf8')
    expect(pythonLicense).toContain('PYTHON SOFTWARE FOUNDATION LICENSE')
  })
})

describe('copyRuntimeTree', () => {
  it('preserves POSIX in-tree file symlinks and skips unsafe or dangling links', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-runtime-preserve-'))
    try {
      const source = join(tmp, 'extract')
      const dest = join(tmp, 'vendor-git')
      mkdirSync(join(source, 'bin'), { recursive: true })
      mkdirSync(join(source, 'libexec', 'git-core'), { recursive: true })
      mkdirSync(join(source, 'dev'), { recursive: true })
      writeFileSync(join(source, 'libexec', 'git-core', 'git'), 'git-binary', { mode: 0o755 })
      writeFileSync(join(source, 'bin', 'scalar'), 'scalar-binary', { mode: 0o755 })
      symlinkSync('git', join(source, 'libexec', 'git-core', 'git-fetch'))
      symlinkSync('git', join(source, 'libexec', 'git-core', 'git-clone'))
      symlinkSync('../libexec/git-core/git', join(source, 'bin', 'git'))
      symlinkSync('/proc/self/fd', join(source, 'dev', 'fd'))
      symlinkSync('/etc/passwd', join(source, 'bin', 'escape'))
      symlinkSync('missing-target', join(source, 'bin', 'dangling'))

      copyRuntimeTree(source, dest, { preserveSymlinks: true })

      expect(lstatSync(join(dest, 'libexec', 'git-core', 'git-fetch')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(dest, 'libexec', 'git-core', 'git-fetch'), 'utf8')).toBe('git-binary')
      expect(lstatSync(join(dest, 'libexec', 'git-core', 'git-clone')).isSymbolicLink()).toBe(true)
      expect(lstatSync(join(dest, 'bin', 'git')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(dest, 'bin', 'git'), 'utf8')).toBe('git-binary')
      expect(lstatSync(join(dest, 'libexec', 'git-core', 'git')).isSymbolicLink()).toBe(false)
      expect((lstatSync(join(dest, 'libexec', 'git-core', 'git')).mode & 0o111) !== 0).toBe(true)
      expect(existsSync(join(dest, 'dev', 'fd'))).toBe(false)
      expect(existsSync(join(dest, 'bin', 'escape'))).toBe(false)
      expect(existsSync(join(dest, 'bin', 'dangling'))).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('keeps Windows flattening of in-tree file links while still skipping Unix vfs links', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-runtime-flatten-'))
    try {
      const source = join(tmp, 'extract')
      const dest = join(tmp, 'vendor-git')
      mkdirSync(join(source, 'libexec', 'git-core'), { recursive: true })
      mkdirSync(join(source, 'dev'), { recursive: true })
      writeFileSync(join(source, 'libexec', 'git-core', 'git'), 'git-binary', { mode: 0o755 })
      symlinkSync('git', join(source, 'libexec', 'git-core', 'git-fetch'))
      symlinkSync('/proc/self/fd', join(source, 'dev', 'fd'))

      copyRuntimeTree(source, dest, { preserveSymlinks: false })

      expect(lstatSync(join(dest, 'libexec', 'git-core', 'git-fetch')).isSymbolicLink()).toBe(false)
      expect(readFileSync(join(dest, 'libexec', 'git-core', 'git-fetch'), 'utf8')).toBe('git-binary')
      expect(existsSync(join(dest, 'dev', 'fd'))).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('invalidates vendor stamps that predate symlink-preserving treeFormat', () => {
    expect(shouldPreserveRuntimeSymlinks('darwin')).toBe(true)
    expect(shouldPreserveRuntimeSymlinks('linux')).toBe(true)
    expect(shouldPreserveRuntimeSymlinks('win32')).toBe(false)
    expect(HOST_RUNTIME_TREE_FORMAT).toBe(2)

    const tmp = mkdtempSync(join(tmpdir(), 'runtime-stamp-'))
    try {
      const expected = {
        kind: 'git' as const,
        version: 'v2.56.1+git-2.56.1',
        platform: 'darwin' as const,
        arch: 'arm64' as const,
        treeFormat: HOST_RUNTIME_TREE_FORMAT,
      }
      const stampPath = join(tmp, '.selection-runtime.json')
      writeFileSync(stampPath, JSON.stringify({
        kind: expected.kind,
        version: expected.version,
        platform: expected.platform,
        arch: expected.arch,
      }))
      expect(stampMatches(tmp, expected)).toBe(false)
      writeFileSync(stampPath, JSON.stringify(expected))
      expect(stampMatches(tmp, expected)).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('skips Git-for-Windows MSYS Unix symlinks that break cpSync dereference on Windows', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-runtime-copy-'))
    try {
      const source = join(tmp, 'extract')
      const dest = join(tmp, 'vendor-git')
      const danglingOnly = join(tmp, 'dangling-extract')
      const cpDest = join(tmp, 'cp-sync-dest')
      mkdirSync(join(source, 'cmd'), { recursive: true })
      mkdirSync(join(source, 'bin'), { recursive: true })
      mkdirSync(join(source, 'dev'), { recursive: true })
      mkdirSync(join(source, 'etc'), { recursive: true })
      mkdirSync(join(source, 'mingw64', 'bin'), { recursive: true })
      writeFileSync(join(source, 'cmd', 'git.exe'), 'git-binary')
      writeFileSync(join(source, 'bin', 'bash.exe'), 'bash-binary')
      writeFileSync(join(source, 'mingw64', 'bin', 'git.exe'), 'mingw-git')
      writeFileSync(join(source, 'readme.txt'), 'hello')
      symlinkSync('readme.txt', join(source, 'readme.link'))
      symlinkSync('/proc/self/fd', join(source, 'dev', 'fd'))
      symlinkSync('/proc/self/fd/2', join(source, 'dev', 'stderr'))
      symlinkSync('/proc/self/fd/0', join(source, 'dev', 'stdin'))
      symlinkSync('/proc/self/fd/1', join(source, 'dev', 'stdout'))
      symlinkSync('/proc/mounts', join(source, 'etc', 'mtab'))
      symlinkSync('missing-rel-target', join(source, 'dev', 'dangling'))

      mkdirSync(join(danglingOnly, 'dev'), { recursive: true })
      writeFileSync(join(danglingOnly, 'ok.txt'), 'ok')
      symlinkSync('missing-rel-target', join(danglingOnly, 'dev', 'fd'))
      expect(() => cpSync(danglingOnly, cpDest, { recursive: true, dereference: true })).toThrow(/ENOENT|no such file/i)

      replaceTree(source, dest)

      expect(readFileSync(join(dest, 'cmd', 'git.exe'), 'utf8')).toBe('git-binary')
      expect(readFileSync(join(dest, 'bin', 'bash.exe'), 'utf8')).toBe('bash-binary')
      expect(readFileSync(join(dest, 'mingw64', 'bin', 'git.exe'), 'utf8')).toBe('mingw-git')
      expect(readFileSync(join(dest, 'readme.txt'), 'utf8')).toBe('hello')
      expect(readFileSync(join(dest, 'readme.link'), 'utf8')).toBe('hello')
      expect(lstatSync(join(dest, 'readme.link')).isSymbolicLink()).toBe(false)
      expect(existsSync(join(dest, 'dev', 'fd'))).toBe(false)
      expect(existsSync(join(dest, 'dev', 'stderr'))).toBe(false)
      expect(existsSync(join(dest, 'dev', 'stdin'))).toBe(false)
      expect(existsSync(join(dest, 'dev', 'stdout'))).toBe(false)
      expect(existsSync(join(dest, 'etc', 'mtab'))).toBe(false)
      expect(existsSync(join(dest, 'dev', 'dangling'))).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('does not follow cyclic directory symlinks and still copies real files', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'git-runtime-cycle-'))
    try {
      const source = join(tmp, 'extract')
      const dest = join(tmp, 'vendor')
      mkdirSync(join(source, 'bin'), { recursive: true })
      writeFileSync(join(source, 'bin', 'python3'), 'python')
      symlinkSync('..', join(source, 'bin', 'loop'))
      copyRuntimeTree(source, dest)
      expect(readFileSync(join(dest, 'bin', 'python3'), 'utf8')).toBe('python')
      expect(existsSync(join(dest, 'bin', 'loop'))).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
