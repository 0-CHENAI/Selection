/**
 * HEIC/HEIF → JPEG via heic-convert (WASM libheif).
 *
 * Sharp's prebuilt libvips often ships without HEVC, so iPhone photos fail
 * there. This path does not depend on a platform codec.
 */

export type HeicConvertFn = (options: {
  buffer: Uint8Array
  format: 'JPEG' | 'PNG'
  quality?: number
}) => Promise<ArrayBuffer | Uint8Array | Buffer>

const HEIC_BRANDS = new Set(['heic', 'heix', 'heif', 'mif1', 'msf1', 'hevc'])

export function isHeicBuffer(buffer: Uint8Array): boolean {
  if (buffer.length < 12) return false
  const brandBox = Buffer.from(buffer.subarray(4, 8)).toString('ascii')
  if (brandBox !== 'ftyp') return false
  const brand = Buffer.from(buffer.subarray(8, 12)).toString('ascii').toLowerCase()
  return HEIC_BRANDS.has(brand)
}

export function isHeicImage(input: {
  mimeType?: string
  name?: string
  bytes?: Uint8Array
}): boolean {
  const mime = input.mimeType?.toLowerCase()
  if (mime === 'image/heic' || mime === 'image/heif') return true
  if (input.name && /\.hei[cf]$/i.test(input.name)) return true
  if (input.bytes && isHeicBuffer(input.bytes)) return true
  return false
}

async function loadDefaultConvert(): Promise<HeicConvertFn> {
  const mod = await import('heic-convert') as { default?: HeicConvertFn } & HeicConvertFn
  return typeof mod === 'function' ? mod : (mod.default as HeicConvertFn)
}

export async function convertHeicToJpeg(
  input: Buffer,
  convert?: HeicConvertFn,
): Promise<Buffer> {
  const impl = convert ?? await loadDefaultConvert()
  const result = await impl({
    buffer: input,
    format: 'JPEG',
    quality: 0.92,
  })
  return Buffer.from(result)
}
