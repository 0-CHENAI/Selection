/**
 * HEIC/HEIF → JPEG via heic-convert (WASM libheif).
 *
 * Sharp's prebuilt libvips often ships without HEVC, so iPhone photos fail
 * there. This path does not depend on a platform codec.
 *
 * Import heic-convert statically so esbuild inlines it (and libheif-js's
 * wasm-bundle) into main.cjs. A runtime import("heic-convert") would miss
 * the packaged app because electron-builder excludes node_modules.
 */

/// <reference path="./heic-convert.d.ts" />
import heicConvert from 'heic-convert'

export type HeicConvertFn = (options: {
  buffer: Uint8Array
  format: 'JPEG' | 'PNG'
  quality?: number
}) => Promise<ArrayBuffer | Uint8Array | Buffer>

export const HEIC_PREVIEW_UNAVAILABLE = 'HEIC_PREVIEW_UNAVAILABLE'

export class HeicPreviewUnavailableError extends Error {
  readonly code = HEIC_PREVIEW_UNAVAILABLE
  constructor(cause?: unknown) {
    const reason = cause instanceof Error ? cause.message : cause ? String(cause) : 'conversion failed'
    super(`Could not convert the HEIC/HEIF photo: ${reason}`)
    this.name = 'HeicPreviewUnavailableError'
  }
}

/** Brands that identify HEIC/HEIF (not AVIF). */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heif', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'msf1'])
const AVIF_BRANDS = new Set(['avif', 'avis', 'avia'])
const HEIC_CONTAINER_BRANDS = new Set(['mif1', 'miaf'])

const jpegCache = new Map<string, Buffer>()
const MAX_JPEG_CACHE = 32

function readFourCc(buffer: Uint8Array, offset: number): string {
  if (offset + 4 > buffer.length) return ''
  return Buffer.from(buffer.subarray(offset, offset + 4)).toString('ascii').toLowerCase()
}

function collectFtypBrands(buffer: Uint8Array): string[] {
  if (buffer.length < 16 || readFourCc(buffer, 4) !== 'ftyp') return []
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const boxSize = view.getUint32(0)
  const end = boxSize >= 16 && boxSize <= buffer.length ? boxSize : Math.min(buffer.length, 64)
  const brands = [readFourCc(buffer, 8)]
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    const brand = readFourCc(buffer, offset)
    if (brand) brands.push(brand)
  }
  return brands
}

export function isHeicBuffer(buffer: Uint8Array): boolean {
  const brands = collectFtypBrands(buffer)
  if (brands.length === 0) return false
  if (brands.some(brand => AVIF_BRANDS.has(brand))) return false
  const major = brands[0] ?? ''
  if (HEIC_BRANDS.has(major)) return true
  if (HEIC_CONTAINER_BRANDS.has(major)) {
    return brands.some(brand => HEIC_BRANDS.has(brand))
  }
  return false
}

export function isHeicFileName(name?: string): boolean {
  if (!name) return false
  const base = name.split(/[/\\]/).pop() ?? name
  return /\.hei[cf]$/i.test(base)
}

export function isHeicImage(input: {
  mimeType?: string
  name?: string
  bytes?: Uint8Array
}): boolean {
  const mime = input.mimeType?.toLowerCase()
  if (mime === 'image/heic' || mime === 'image/heif') return true
  if (isHeicFileName(input.name)) return true
  if (input.bytes && isHeicBuffer(input.bytes)) return true
  return false
}

export function heicCacheKey(path: string, bytes: Uint8Array): string {
  return `${path}:${bytes.byteLength}`
}

export function peekConvertedHeic(key: string): Buffer | undefined {
  return jpegCache.get(key)
}

export function clearConvertedHeicCache(): void {
  jpegCache.clear()
}

function rememberConvertedHeic(key: string, jpeg: Buffer): Buffer {
  jpegCache.delete(key)
  jpegCache.set(key, jpeg)
  while (jpegCache.size > MAX_JPEG_CACHE) {
    const oldest = jpegCache.keys().next().value
    if (oldest === undefined) break
    jpegCache.delete(oldest)
  }
  return jpeg
}

function resolveConvert(mod: unknown): HeicConvertFn {
  if (typeof mod === 'function') return mod as HeicConvertFn
  if (mod && typeof (mod as { default?: unknown }).default === 'function') {
    return (mod as { default: HeicConvertFn }).default
  }
  throw new Error('heic-convert did not export a converter')
}

const bundledConvert = resolveConvert(heicConvert)

export async function convertHeicToJpeg(
  input: Buffer,
  convert?: HeicConvertFn,
  cacheKey?: string,
): Promise<Buffer> {
  if (cacheKey) {
    const hit = jpegCache.get(cacheKey)
    if (hit) return hit
  }
  const impl = convert ?? bundledConvert
  const result = await impl({
    buffer: input,
    format: 'JPEG',
    quality: 0.92,
  })
  const jpeg = Buffer.from(new Uint8Array(result))
  if (cacheKey) rememberConvertedHeic(cacheKey, jpeg)
  return jpeg
}

export async function tryConvertHeicToJpeg(
  input: Buffer,
  convert?: HeicConvertFn,
  cacheKey?: string,
): Promise<Buffer | null> {
  try {
    return await convertHeicToJpeg(input, convert, cacheKey)
  } catch {
    return null
  }
}
