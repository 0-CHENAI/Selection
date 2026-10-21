/**
 * Sharp encode path shared by the Electron and headless image processors.
 * Send-size encoding sets `normalize` so pixels are rotated into sRGB before
 * the quality ladder. Thumbnail and icon calls leave that off.
 */

export interface SharpImageEncodeOptions {
  resize?: { width: number; height: number }
  fit?: 'inside' | 'cover' | 'fill'
  format?: 'png' | 'jpeg' | 'webp'
  quality?: number
  effort?: number
  withoutEnlargement?: boolean
  /** Apply EXIF rotation and convert to sRGB before resize/encode. */
  normalize?: boolean
}

export async function readSharpMetadata(
  buffer: Buffer,
): Promise<{ width: number; height: number; hasAlpha?: boolean } | null> {
  const sharp = (await import('sharp')).default
  const metadata = await sharp(buffer).metadata().catch(() => null)
  if (!metadata?.width || !metadata.height) return null
  return {
    width: metadata.width,
    height: metadata.height,
    ...(typeof metadata.hasAlpha === 'boolean' ? { hasAlpha: metadata.hasAlpha } : {}),
  }
}

export async function encodeWithSharp(
  input: Buffer | string,
  opts: SharpImageEncodeOptions = {},
): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  let pipeline = sharp(input, { failOn: 'none' })
  if (opts.normalize) {
    pipeline = pipeline.rotate().toColourspace('srgb')
  }
  if (opts.resize) {
    pipeline = pipeline.resize(opts.resize.width, opts.resize.height, {
      fit: opts.fit ?? 'inside',
      withoutEnlargement: opts.withoutEnlargement === true,
    })
  }
  if (opts.format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: opts.quality ?? 90 })
  } else if (opts.format === 'webp') {
    pipeline = pipeline.webp({ quality: opts.quality ?? 85, effort: opts.effort ?? 0 })
  } else {
    pipeline = pipeline.png()
  }
  return pipeline.toBuffer()
}
