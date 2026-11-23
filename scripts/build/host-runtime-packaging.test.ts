import { describe, expect, it } from 'bun:test'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { copyRuntimeTree } from './host-runtimes.ts'

const { copyAgentRuntimes } = require('../../apps/electron/scripts/afterPack.cjs') as {
  copyAgentRuntimes: (
    context: { electronPlatformName: string; packager: { projectDir: string } },
    resourcesRoot: string,
  ) => void
}

/**
 * electron-builder FileCopier creates dest symlinks with fs.symlink and does
 * not unlink an existing path. Package Desktop 45133668791 failed that way
 * when `files` and extraResources both copied vendor/git:
 *   EEXIST: file already exists, symlink 'git' -> '.../git-core/git-add'
 */
function electronBuilderCopyTree(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const name of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, name.name)
    const to = join(destination, name.name)
    if (name.isDirectory()) {
      electronBuilderCopyTree(from, to)
      continue
    }
    if (name.isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to)
      continue
    }
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
}

function seedDugiteStyleGit(root: string): void {
  mkdirSync(join(root, 'bin'), { recursive: true })
  mkdirSync(join(root, 'libexec', 'git-core'), { recursive: true })
  writeFileSync(join(root, 'libexec', 'git-core', 'git'), 'git-binary', { mode: 0o755 })
  chmodSync(join(root, 'libexec', 'git-core', 'git'), 0o755)
  writeFileSync(join(root, 'bin', 'git'), 'git-binary', { mode: 0o755 })
  symlinkSync('git', join(root, 'libexec', 'git-core', 'git-add'))
  symlinkSync('git', join(root, 'libexec', 'git-core', 'git-fetch'))
}

function seedPackagingProject(projectDir: string): void {
  const files = [
    'resources/session-mcp-server/index.js',
    'resources/pi-agent-server/index.js',
    'resources/pi-agent-server/image-resize-worker.js',
    'resources/pi-agent-server/read-image-resize-worker.js',
    'resources/pi-agent-server/photon_rs_bg.wasm',
    'vendor/bun/bun',
    'node_modules/@vscode/ripgrep/bin/rg',
  ]
  for (const file of files) {
    mkdirSync(join(projectDir, file, '..'), { recursive: true })
    writeFileSync(join(projectDir, file), file)
  }
  seedDugiteStyleGit(join(projectDir, 'vendor/git'))
  mkdirSync(join(projectDir, 'vendor/python/bin'), { recursive: true })
  writeFileSync(join(projectDir, 'vendor/python/bin/python3.12'), 'python-binary', { mode: 0o755 })
  symlinkSync('python3.12', join(projectDir, 'vendor/python/bin/python3'))
}

function yamlFilesIncludesVendorRuntime(builder: string): string[] {
  return builder.split('\n').filter((line) =>
    /^\s+- vendor\/(?:git|python)/.test(line) && !line.includes('!'),
  )
}

describe('electron-builder host runtime packaging', () => {
  it('does not list vendor git/python in files while extraResources still copies them', () => {
    const builder = readFileSync(
      join(import.meta.dir, '../../apps/electron/electron-builder.yml'),
      'utf8',
    )
    expect(yamlFilesIncludesVendorRuntime(builder)).toEqual([])
    expect(builder).toContain('!vendor/git/**/*')
    expect(builder).toContain('!vendor/python/**/*')
    for (const block of builder.split(/\n(?=mac:|win:|linux:)/)) {
      if (!/^(mac|win|linux):/.test(block)) continue
      expect(block).toContain('from: vendor/git')
      expect(block).toContain('from: vendor/python')
    }
  })

  it('reproduces the macOS files+extraResources EEXIST on git-add', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pack-eexist-'))
    try {
      const source = join(tmp, 'vendor/git')
      const dest = join(tmp, 'app/vendor/git')
      seedDugiteStyleGit(source)
      // #834 yml: files glob copied the tree, extraResources copied it again.
      electronBuilderCopyTree(source, dest)
      expect(lstatSync(join(dest, 'libexec/git-core/git-add')).isSymbolicLink()).toBe(true)
      expect(() => electronBuilderCopyTree(source, dest)).toThrow(
        /EEXIST: file already exists, symlink 'git'/,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('packs Git/Python through extraResources once then afterPack without flattening links', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pack-once-'))
    try {
      const projectDir = join(tmp, 'project')
      const resourcesRoot = join(tmp, 'Selection.app/Contents/Resources')
      seedPackagingProject(projectDir)

      // extraResources (single copy), matching the electron-builder.yml fix.
      copyRuntimeTree(
        join(projectDir, 'vendor/git'),
        join(resourcesRoot, 'app/vendor/git'),
        { preserveSymlinks: true },
      )
      copyRuntimeTree(
        join(projectDir, 'vendor/python'),
        join(resourcesRoot, 'app/vendor/python'),
        { preserveSymlinks: true },
      )

      copyAgentRuntimes({ electronPlatformName: 'darwin', packager: { projectDir } }, resourcesRoot)

      const gitAdd = join(resourcesRoot, 'app/vendor/git/libexec/git-core/git-add')
      const python3 = join(resourcesRoot, 'app/vendor/python/bin/python3')
      expect(lstatSync(gitAdd).isSymbolicLink()).toBe(true)
      expect(readlinkSync(gitAdd)).toBe('git')
      expect(readFileSync(gitAdd, 'utf8')).toBe('git-binary')
      expect(lstatSync(python3).isSymbolicLink()).toBe(true)
      expect(existsSync(join(resourcesRoot, 'app/vendor/git/bin/git'))).toBe(true)
      expect((lstatSync(join(resourcesRoot, 'app/vendor/git/libexec/git-core/git')).mode & 0o111) !== 0).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
