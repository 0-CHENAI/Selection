import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DUGITE_NATIVE_VERSION,
  GIT_FOR_WINDOWS_VERSION,
  PYTHON_STANDALONE_TAG,
  PYTHON_STANDALONE_VERSION,
  getGitArtifact,
  getPythonArtifact,
  hasHostRuntimeArtifacts,
  resolveBundleConfig,
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
    expect(builder).toContain('- vendor/git/**/*')
    expect(builder).toContain('- vendor/python/**/*')
    expect(builder).toContain('from: vendor/git')
    expect(builder).toContain('to: app/vendor/git')
    expect(builder).toContain('from: vendor/python')
    expect(builder).toContain('to: app/vendor/python')
    expect(builder).toContain('!vendor/git/**/*')
    expect(builder).toContain('!vendor/python/**/*')

    const afterPack = readFileSync(join(repoRoot, 'apps/electron/scripts/afterPack.cjs'), 'utf8')
    expect(afterPack).toContain('vendor/git')
    expect(afterPack).toContain('vendor/python')
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
