import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const PHOTON_WASM_FILENAME = 'photon_rs_bg.wasm'
const LEGACY_WORD_LICENSE_FILENAME = 'legacy-word-extractor.LICENSE.txt'
export const PI_AUXILIARY_ENTRIES = [
  'image-resize-worker.js', 'read-image-resize-worker.js', 'legacy-word-extractor.js', LEGACY_WORD_LICENSE_FILENAME,
] as const

export function verifyPiAuxiliaryEntries(directory: string): void {
  for (const entry of PI_AUXILIARY_ENTRIES) {
    const path = join(directory, entry)
    if (!existsSync(path)) throw new Error(`Pi runtime entry not found at ${path}`)
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
  mkdirSync(outputDir, { recursive: true })
  copyFileSync(join(rootDir, 'node_modules', 'word-extractor', 'LICENSE'), join(outputDir, LEGACY_WORD_LICENSE_FILENAME))
  verifyPiAuxiliaryEntries(outputDir)
  copyFileSync(photonWasmSource, join(outputDir, PHOTON_WASM_FILENAME))
}

if (import.meta.main) {
  const rootDir = resolve(import.meta.dir, '..', '..', '..')
  const outputDir = resolve(import.meta.dir, '..', 'dist')
  copyPiAgentServerRuntimeAssets(rootDir, outputDir)
  console.log(`Copied ${PHOTON_WASM_FILENAME} to pi-agent-server/dist`)
}
