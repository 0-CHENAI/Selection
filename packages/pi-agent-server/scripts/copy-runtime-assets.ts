import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const PHOTON_WASM_FILENAME = 'photon_rs_bg.wasm'

export function copyPiAgentServerRuntimeAssets(rootDir: string, outputDir: string): void {
  const photonWasmSource = join(
    rootDir,
    'node_modules',
    '@silvia-odwyer',
    'photon-node',
    PHOTON_WASM_FILENAME,
  )

  if (!existsSync(photonWasmSource)) {
    throw new Error(
      `Photon WASM not found at ${photonWasmSource}. Run bun install before building pi-agent-server.`,
    )
  }

  mkdirSync(outputDir, { recursive: true })
  copyFileSync(photonWasmSource, join(outputDir, PHOTON_WASM_FILENAME))
}

if (import.meta.main) {
  const rootDir = resolve(import.meta.dir, '..', '..', '..')
  const outputDir = resolve(import.meta.dir, '..', 'dist')
  copyPiAgentServerRuntimeAssets(rootDir, outputDir)
  console.log(`Copied ${PHOTON_WASM_FILENAME} to pi-agent-server/dist`)
}
