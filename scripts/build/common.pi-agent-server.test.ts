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
import { join } from 'node:path'
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
  it('copies Photon WASM through the build and desktop packaging chain', () => {
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
    expect(existsSync(packagedWasm)).toBe(true)
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
})
