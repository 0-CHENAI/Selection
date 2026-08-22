import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PHOTON_WASM_FILENAME = 'photon_rs_bg.wasm'

const require = createRequire(import.meta.url)
const fs = require('node:fs') as typeof import('node:fs')
let photonModule: PhotonModuleLike | null = null
let photonLoadPromise: Promise<PhotonModuleLike> | null = null

export interface PhotonImageLike {
  free(): void
  get_width(): number
  get_height(): number
  get_raw_pixels(): Uint8Array
  get_bytes(): Uint8Array
  get_bytes_jpeg(quality: number): Uint8Array
}

export interface PhotonModuleLike {
  PhotonImage: {
    new(rawPixels: Uint8Array, width: number, height: number): PhotonImageLike
    new_from_byteslice(bytes: Uint8Array): PhotonImageLike
  }
  SamplingFilter: {
    Lanczos3: number
  }
  resize(image: PhotonImageLike, width: number, height: number, filter: number): PhotonImageLike
  fliph(image: PhotonImageLike): void
  flipv(image: PhotonImageLike): void
}

function photonWasmFallbackPaths(): string[] {
  return [
    join(dirname(fileURLToPath(import.meta.url)), PHOTON_WASM_FILENAME),
    join(dirname(process.execPath), PHOTON_WASM_FILENAME),
    join(dirname(process.execPath), 'photon', PHOTON_WASM_FILENAME),
    join(process.cwd(), PHOTON_WASM_FILENAME),
  ]
}

function patchPhotonWasmRead(): () => void {
  const originalReadFileSync = fs.readFileSync
  const boundReadFileSync = originalReadFileSync.bind(fs) as typeof fs.readFileSync
  const patchedReadFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    const [path, options] = args
    const requestedPath = path instanceof URL ? fileURLToPath(path) : String(path)
    if (!requestedPath.endsWith(PHOTON_WASM_FILENAME)) {
      return boundReadFileSync(...args)
    }

    try {
      return boundReadFileSync(...args)
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code && code !== 'ENOENT') throw error
      for (const fallbackPath of photonWasmFallbackPaths()) {
        if (!fs.existsSync(fallbackPath)) continue
        return options === undefined
          ? boundReadFileSync(fallbackPath)
          : boundReadFileSync(fallbackPath, options)
      }
      throw error
    }
  }) as typeof fs.readFileSync

  fs.readFileSync = patchedReadFileSync
  return () => {
    fs.readFileSync = originalReadFileSync
  }
}

export async function loadPhoton(): Promise<PhotonModuleLike> {
  if (photonModule) return photonModule
  if (photonLoadPromise) return photonLoadPromise

  photonLoadPromise = (async () => {
    const restoreReadFileSync = patchPhotonWasmRead()
    try {
      photonModule = await import('@silvia-odwyer/photon-node') as unknown as PhotonModuleLike
      return photonModule
    } finally {
      restoreReadFileSync()
    }
  })()

  try {
    return await photonLoadPromise
  } catch (error) {
    photonLoadPromise = null
    throw error
  }
}
