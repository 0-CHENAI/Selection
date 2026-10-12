import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { pruneForeignPlatformRuntimes, resolvePackagedResourcesRoot } = require('./afterPack.cjs') as {
  pruneForeignPlatformRuntimes: (
    context: { arch: string | number; electronPlatformName: string },
    resourcesRoot: string,
  ) => void
  resolvePackagedResourcesRoot: (context: {
    electronPlatformName: string
    appOutDir: string
    packager: { appInfo: { productFilename: string } }
  }) => string
}

const { copySharpRuntime } = require('./afterPack.cjs') as {
  copySharpRuntime: (context: { arch: string; electronPlatformName: string; packager: { projectDir: string } }, resourcesRoot: string) => void
}

const { copyAgentRuntimes } = require('./afterPack.cjs') as {
  copyAgentRuntimes: (context: { electronPlatformName: string; packager: { projectDir: string } }, resourcesRoot: string) => void
}

describe('afterPack OfficeCLI runtime pruning', () => {
  it('ships the subprocesses and Bun even when the builder filtered native dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-agent-package-'))
    try {
      const projectDir = join(root, 'project')
      const resourcesRoot = join(root, 'packed')
      const context = { electronPlatformName: 'darwin', packager: { projectDir } }
      expect(() => copyAgentRuntimes(context, resourcesRoot)).toThrow('Required agent runtime')
      const files = ['resources/session-mcp-server/index.js', 'resources/pi-agent-server/index.js',
        'resources/pi-agent-server/image-resize-worker.js', 'resources/pi-agent-server/photon_rs_bg.wasm',
        'resources/pi-agent-server/node_modules/koffi/native.node', 'vendor/bun/bun', 'node_modules/@vscode/ripgrep/bin/rg']
      for (const file of files) {
        mkdirSync(join(projectDir, file, '..'), { recursive: true })
        writeFileSync(join(projectDir, file), file)
      }
      copyAgentRuntimes(context, resourcesRoot)
      for (const file of files) expect(readFileSync(join(resourcesRoot, 'app', file), 'utf8')).toBe(file)
      rmSync(join(projectDir, 'resources/pi-agent-server/photon_rs_bg.wasm'))
      expect(() => copyAgentRuntimes(context, resourcesRoot)).toThrow('Packaged agent runtime is missing')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('copies the target sharp binding into the packaged app and rejects missing bindings', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-sharp-package-'))
    try {
      const projectDir = join(root, 'apps', 'electron')
      const resourcesRoot = join(root, 'packed', 'resources')
      const source = join(root, 'node_modules', '@img')
      mkdirSync(join(root, 'node_modules', 'sharp'), { recursive: true })
      writeFileSync(join(root, 'node_modules', 'sharp', 'package.json'), JSON.stringify({ optionalDependencies: {
        '@img/sharp-win32-x64': '0.34.5',
      } }))
      mkdirSync(join(source, 'sharp-win32-x64', 'lib'), { recursive: true })
      writeFileSync(join(source, 'sharp-win32-x64', 'package.json'), '{}')
      const context = { arch: 'x64', electronPlatformName: 'win32', packager: { projectDir } }
      expect(() => copySharpRuntime(context, resourcesRoot)).toThrow('binding is missing')
      writeFileSync(join(source, 'sharp-win32-x64', 'lib', 'sharp-win32-x64.node'), 'native binding')
      expect(() => copySharpRuntime(context, resourcesRoot)).toThrow('libvips DLL is missing')
      writeFileSync(join(source, 'sharp-win32-x64', 'lib', 'libvips-42.dll'), 'native dependency')
      copySharpRuntime(context, resourcesRoot)
      expect(existsSync(join(resourcesRoot, 'app', 'node_modules', '@img', 'sharp-win32-x64', 'lib', 'sharp-win32-x64.node'))).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('never recursively packages prior desktop release directories', () => {
    const config = readFileSync(join(import.meta.dir, '../electron-builder.yml'), 'utf8')
    expect(config).toContain('- "!release/**"')
    expect(config).toContain('- "!release-swarm-preview/**"')
    expect(config.match(/- "!\*\*\/resources\/scripts\/tests\/\*\*"/g)).toHaveLength(4)
    expect(config.match(/- "!\*\*\/__pycache__\/\*\*"/g)).toHaveLength(4)
    expect(config.match(/^    - dist\/\*\*\/\*$/gm)).toHaveLength(3)
  })

  it('resolves the macOS resources path from the configured product filename', () => {
    expect(resolvePackagedResourcesRoot({
      electronPlatformName: 'darwin',
      appOutDir: '/tmp/out',
      packager: { appInfo: { productFilename: 'Selection Swarm Preview' } },
    })).toBe('/tmp/out/Selection Swarm Preview.app/Contents/Resources')
  })

  it('keeps only the target platform runtime in every packaged resource copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-after-pack-'))
    try {
      for (const relativeBin of ['app/resources/bin', 'app/dist/resources/bin']) {
        for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
          const directory = join(root, relativeBin, target)
          mkdirSync(directory, { recursive: true })
          writeFileSync(join(directory, 'officecli'), target)
        }
      }

      pruneForeignPlatformRuntimes({ electronPlatformName: 'darwin', arch: 'arm64' }, root)
      for (const relativeBin of ['app/resources/bin', 'app/dist/resources/bin']) {
        expect(existsSync(join(root, relativeBin, 'darwin-arm64', 'officecli'))).toBe(true)
        expect(existsSync(join(root, relativeBin, 'darwin-x64'))).toBe(false)
        expect(existsSync(join(root, relativeBin, 'win32-x64'))).toBe(false)
        expect(existsSync(join(root, relativeBin, 'linux-x64'))).toBe(false)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed for an unreviewed package target', () => {
    expect(() => pruneForeignPlatformRuntimes(
      { electronPlatformName: 'linux', arch: 'arm64' },
      '/definitely-not-a-package',
    )).toThrow('Unsupported packaged OfficeCLI target')
  })
})
