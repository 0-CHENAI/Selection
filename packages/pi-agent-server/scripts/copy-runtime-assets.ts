import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const PHOTON_WASM_FILENAME = 'photon_rs_bg.wasm'
export const IMAGE_RESIZE_WORKERS = ['image-resize-worker.js', 'read-image-resize-worker.js'] as const

export function verifyImageResizeWorkers(directory: string): void {
  for (const worker of IMAGE_RESIZE_WORKERS) {
    const path = join(directory, worker)
    if (!existsSync(path)) throw new Error(`Pi image resize Worker not found at ${path}`)
  }
}

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
  verifyImageResizeWorkers(outputDir)

  mkdirSync(outputDir, { recursive: true })
  copyFileSync(photonWasmSource, join(outputDir, PHOTON_WASM_FILENAME))
}

if (import.meta.main) {
  const rootDir = resolve(import.meta.dir, '..', '..', '..')
  const outputDir = resolve(import.meta.dir, '..', 'dist')
  copyPiAgentServerRuntimeAssets(rootDir, outputDir)
  console.log(`Copied ${PHOTON_WASM_FILENAME} to pi-agent-server/dist`)
}
