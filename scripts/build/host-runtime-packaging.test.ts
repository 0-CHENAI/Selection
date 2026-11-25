import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { prepareDesktopHostRuntimes } from '../../apps/electron/src/main/host-runtime-cache'
import { hostRuntimeArchiveDirectory, sha256File } from '../../apps/electron/src/main/host-runtime-archive.cjs'

const { packageHostRuntimeArchives } = require('../../apps/electron/scripts/package-host-runtimes.cjs') as {
  packageHostRuntimeArchives: (projectDir: string, resourcesBase: string, platform: string, arch: string) => void
}
const platform = process.platform
const archiveTestPlatform = platform === 'win32' ? 'win32' : 'darwin'
const gitPaths = archiveTestPlatform === 'win32'
  ? ['cmd/git.exe', 'ucrt64/bin/git.exe', 'bin/bash.exe', 'usr/bin/bash.exe']
  : ['bin/git', 'libexec/git-core/git']
const pythonPaths = archiveTestPlatform === 'win32'
  ? ['python.exe', 'python3.exe', 'python312.dll', 'Lib/encodings/__init__.py']
  : ['bin/python3', 'lib/python3.12/encodings/__init__.py']

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, { mode: 0o755 })
}

function seedRuntime(project: string, kind: 'git' | 'python', version: string): void {
  const root = join(project, 'vendor', kind)
  for (const file of kind === 'git' ? gitPaths : pythonPaths) {
    writeFile(join(root, file), `${kind}-${version}-${file}`)
  }
  writeFile(join(root, '.selection-runtime.json'), JSON.stringify({
    kind, version, platform: archiveTestPlatform, arch: process.arch, treeFormat: 2,
  }))
}

describe('desktop Git/Python packaging', () => {
  it('keeps unpacked trees out of the macOS and Windows payloads', () => {
    const builder = readFileSync(join(import.meta.dir, '../../apps/electron/electron-builder.yml'), 'utf8')
    expect(builder).toContain('!vendor/git/**/*')
    expect(builder).toContain('!vendor/python/**/*')
    for (const block of builder.split(/\n(?=mac:|win:|linux:)/)) {
      if (/^(mac|win):/.test(block)) {
        expect(block).not.toMatch(/from: vendor\/(git|python)/)
      } else if (block.startsWith('linux:')) {
        expect(block).toContain('from: vendor/git')
        expect(block).toContain('from: vendor/python')
      }
    }
  })

  it.skipIf(platform === 'linux')('installs offline, reuses healthy components, and repairs only changed or damaged components', async () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-host-runtime-'))
    try {
      const project = join(root, 'project')
      const resourcesBase = join(root, 'installed app')
      const cacheRoot = join(root, 'local runtimes')
      seedRuntime(project, 'git', '1')
      seedRuntime(project, 'python', '1')
      packageHostRuntimeArchives(project, resourcesBase, platform, process.arch)

      const errors: unknown[] = []
      const prepare = () => prepareDesktopHostRuntimes(resourcesBase, cacheRoot, (_kind, error) => errors.push(error))
      const first = await prepare()
      expect(errors).toEqual([])
      expect(first.git).toBeDefined()
      expect(first.python).toBeDefined()
      expect(existsSync(join(resourcesBase, 'vendor/git'))).toBe(false)
      const gitMarker = join(first.git!, gitPaths[0]!)
      const pythonMarker = join(first.python!, pythonPaths[0]!)
      const gitSentinel = join(first.git!, 'user-sentinel')
      const pythonSentinel = join(first.python!, 'user-sentinel')
      writeFileSync(gitSentinel, 'keep until repair')
      writeFileSync(pythonSentinel, 'keep through upgrade')

      // A later full installer includes a fresh archive, but provisioning should ignore it
      // while the existing files match the manifest.
      const gitArchive = join(hostRuntimeArchiveDirectory(resourcesBase), 'git.tar.gz')
      const originalArchiveHash = sha256File(gitArchive)
      writeFileSync(gitArchive, 'damaged compressed file')
      expect(await prepare()).toEqual(first)
      expect(existsSync(gitSentinel)).toBe(true)
      expect(existsSync(pythonSentinel)).toBe(true)

      // A same-length edit is still corruption, even when the key binaries exist.
      const original = readFileSync(gitMarker, 'utf8')
      writeFileSync(gitMarker, 'x'.repeat(original.length))
      expect(await prepare()).toEqual({ python: first.python })
      expect(errors).toHaveLength(1)
      expect(existsSync(gitSentinel)).toBe(true)

      packageHostRuntimeArchives(project, resourcesBase, platform, process.arch)
      expect(sha256File(gitArchive)).toBe(originalArchiveHash)
      expect(await prepare()).toEqual(first)
      expect(readFileSync(gitMarker, 'utf8')).toBe(original)
      expect(existsSync(gitSentinel)).toBe(false)
      expect(existsSync(pythonSentinel)).toBe(true)

      seedRuntime(project, 'git', '2')
      packageHostRuntimeArchives(project, resourcesBase, platform, process.arch)
      const updated = await prepare()
      expect(updated.git).not.toBe(first.git)
      expect(updated.python).toBe(first.python)
      expect(readFileSync(join(updated.git!, gitPaths[0]!), 'utf8')).toContain('git-2-')
      expect(existsSync(gitMarker)).toBe(true)
      expect(existsSync(pythonMarker)).toBe(true)
      expect(existsSync(pythonSentinel)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(platform === 'win32')('preserves relative macOS links and omits virtual Unix links', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-host-links-'))
    try {
      const resources = join(root, 'resources')
      seedRuntime(root, 'git', '1')
      seedRuntime(root, 'python', '1')
      const gitCore = join(root, 'vendor/git/libexec/git-core')
      symlinkSync('git', join(gitCore, 'git-add'))
      symlinkSync('/proc/self/fd/0', join(gitCore, 'virtual'))
      const pythonBin = join(root, 'vendor/python/bin')
      rmSync(join(pythonBin, 'python3'))
      writeFile(join(pythonBin, 'python3.12'), 'python binary')
      symlinkSync('python3.12', join(pythonBin, 'python3'))
      packageHostRuntimeArchives(root, resources, 'darwin', process.arch)

      // Check the resulting tar on Linux too. A macOS host exercises its usual
      // application startup path in the lifecycle test above.
      const output = join(root, 'output')
      for (const kind of ['git', 'python']) {
        const dest = join(output, kind)
        mkdirSync(dest, { recursive: true })
        execFileSync('/usr/bin/tar', ['-xzf', join(hostRuntimeArchiveDirectory(resources), `${kind}.tar.gz`), '-C', dest])
      }
      const gitAdd = join(output, 'git/libexec/git-core/git-add')
      expect(lstatSync(gitAdd).isSymbolicLink()).toBe(true)
      expect(readlinkSync(gitAdd)).toBe('git')
      expect(() => lstatSync(join(output, 'git/libexec/git-core/virtual'))).toThrow()
      expect(readlinkSync(join(output, 'python/bin/python3'))).toBe('python3.12')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
