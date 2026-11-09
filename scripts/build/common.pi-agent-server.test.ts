import { afterEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { copyPiAgentServerRuntimeAssets } from '../../packages/pi-agent-server/scripts/copy-runtime-assets.ts'
import { copyPiAgentServer, verifyMcpServersExist, type BuildConfig } from './common.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createFixture(): { rootDir: string; electronDir: string; config: BuildConfig } {
  const rootDir = mkdtempSync(join(tmpdir(), 'selection-pi-assets-'))
  const electronDir = join(rootDir, 'apps', 'electron')
  tempDirs.push(rootDir)

  const piDistDir = join(rootDir, 'packages', 'pi-agent-server', 'dist')
  const photonPackageDir = join(rootDir, 'node_modules', '@silvia-odwyer', 'photon-node')
  const koffiDir = join(rootDir, 'node_modules', 'koffi')
  const koffiNativeDir = join(koffiDir, 'build', 'koffi', 'win32_x64')
  const sessionServerDir = join(electronDir, 'resources', 'session-mcp-server')

  for (const dir of [piDistDir, photonPackageDir, koffiNativeDir, sessionServerDir]) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(join(piDistDir, 'index.js'), 'console.log("pi")')
  writeFileSync(join(piDistDir, 'image-resize-worker.js'), 'console.log("worker")')
  writeFileSync(join(photonPackageDir, 'photon_rs_bg.wasm'), 'wasm-fixture')
  writeFileSync(join(koffiDir, 'package.json'), '{}')
  writeFileSync(join(koffiDir, 'index.js'), '')
  writeFileSync(join(koffiNativeDir, 'koffi.node'), 'native-fixture')
  writeFileSync(join(sessionServerDir, 'index.js'), 'console.log("session")')

  return {
    rootDir,
    electronDir,
    config: {
      platform: 'win32',
      arch: 'x64',
      upload: false,
      uploadLatest: false,
      uploadScript: false,
      rootDir,
      electronDir,
    },
  }
}

describe('Pi Agent Server image runtime packaging', () => {
  it('uses the package build in the server image so Worker and WASM are included', () => {
    const dockerfile = readFileSync(resolve(import.meta.dir, '..', '..', 'Dockerfile.server'), 'utf8')

    expect(dockerfile).toContain('cd packages/pi-agent-server && bun run build')
    expect(dockerfile).not.toContain('--outfile packages/pi-agent-server/dist/index.js')
  })

  it('copies the image Worker and Photon WASM through the desktop packaging chain', () => {
    const { rootDir, electronDir, config } = createFixture()
    const piDistDir = join(rootDir, 'packages', 'pi-agent-server', 'dist')

    copyPiAgentServerRuntimeAssets(rootDir, piDistDir)
    copyPiAgentServer(config)

    const packagedWasm = join(
      electronDir,
      'resources',
      'pi-agent-server',
      'photon_rs_bg.wasm',
    )
    const packagedWorker = join(
      electronDir,
      'resources',
      'pi-agent-server',
      'image-resize-worker.js',
    )
    expect(existsSync(packagedWasm)).toBe(true)
    expect(existsSync(packagedWorker)).toBe(true)
    expect(readFileSync(packagedWorker, 'utf-8')).toContain('worker')
    expect(readFileSync(packagedWasm, 'utf-8')).toBe('wasm-fixture')
    expect(() => verifyMcpServersExist(config)).not.toThrow()
  })

  it('fails the build when the Photon WASM dependency is missing', () => {
    const { rootDir } = createFixture()
    const missingRoot = join(rootDir, 'missing-root')

    expect(() =>
      copyPiAgentServerRuntimeAssets(
        missingRoot,
        join(rootDir, 'packages', 'pi-agent-server', 'dist'),
      ),
    ).toThrow('Photon WASM not found')
  })

  it('fails the build when the image resize Worker is missing', () => {
    const { rootDir } = createFixture()
    const piDistDir = join(rootDir, 'packages', 'pi-agent-server', 'dist')
    rmSync(join(piDistDir, 'image-resize-worker.js'))

    expect(() => copyPiAgentServerRuntimeAssets(rootDir, piDistDir)).toThrow(
      'image resize Worker not found',
    )
  })

  it('keeps Pi Agent Server optional when its bundle is not present', () => {
    const { config } = createFixture()

    expect(() => verifyMcpServersExist(config)).not.toThrow()
  })
})
