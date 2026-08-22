import { beforeAll, describe, expect, it } from 'bun:test'
import { encodedSize } from './image-resize-core.ts'
import type { ImageOptimizationResult, ImageResizeLimits } from './image-resize-types.ts'
import { processReadImage } from './image-processing.ts'

let png: Uint8Array
let jpeg: Uint8Array
let webp: Uint8Array
let largePng: Uint8Array

beforeAll(async () => {
  const photon = await import('@silvia-odwyer/photon-node')
  const pixel = new Uint8Array([255, 0, 0, 255])
  const image = new photon.PhotonImage(pixel, 1, 1)
  try {
    png = image.get_bytes()
    jpeg = image.get_bytes_jpeg(80)
    webp = image.get_bytes_webp()
  } finally {
    image.free()
  }

  const widePixels = new Uint8Array(2700 * 4)
  widePixels.fill(255)
  const wideImage = new photon.PhotonImage(widePixels, 2700, 1)
  try {
    largePng = wideImage.get_bytes()
  } finally {
    wideImage.free()
  }
})

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

function optimizedImage(overrides: Partial<Extract<ImageOptimizationResult, { ok: true }>> = {}): ImageOptimizationResult {
  return {
    ok: true,
    bytes: png,
    mimeType: 'image/png',
    originalWidth: 2700,
    originalHeight: 1,
    width: 2560,
    height: 1,
    wasResized: true,
    encodingAttempts: 1,
    resizePasses: 1,
    ...overrides,
  }
}

describe('Pi read image processing', () => {
  it('passes supported small PNG, JPEG, GIF, and WebP images through without starting the optimizer', async () => {
    let optimizerCalls = 0
    const optimize = async (): Promise<ImageOptimizationResult> => {
      optimizerCalls += 1
      throw new Error('optimizer must not run for small inline images')
    }

    for (const [bytes, mimeType] of [
      [png, 'image/png'],
      [jpeg, 'image/jpeg'],
      [gif, 'image/gif'],
      [webp, 'image/webp'],
    ] as const) {
      const result = await processReadImage(bytes, mimeType, {}, { optimize })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.mimeType).toBe(mimeType)
        expect(Buffer.from(result.data, 'base64')).toEqual(Buffer.from(bytes))
      }
    }

    expect(optimizerCalls).toBe(0)
  })

  it('treats an encoded-size equality as over the strict inline limit', async () => {
    let optimizerCalls = 0
    const result = await processReadImage(
      png,
      'image/png',
      { maxEncodedBytes: encodedSize(png.byteLength) },
      {
        optimize: async () => {
          optimizerCalls += 1
          return optimizedImage({ bytes: new Uint8Array([1]) })
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(optimizerCalls).toBe(1)
  })

  it('preserves optimizer failure codes and details', async () => {
    for (const [code, detail] of [
      ['image_runtime_unavailable', 'Photon could not be loaded: ENOENT: photon_rs_bg.wasm'],
      ['image_decode_failed', 'invalid PNG payload'],
      ['image_conversion_failed', 'PNG conversion failed'],
      ['image_resize_failed', 'Lanczos resize failed'],
      ['image_size_limit_exceeded', 'six passes exhausted'],
    ] as const) {
      const result = await processReadImage(largePng, 'image/png', {}, {
        optimize: async () => ({ ok: false, code, detail }),
      })
      expect(result).toEqual({
        ok: false,
        code,
        message: `[Image omitted: ${code}: ${detail}]`,
      })
    }
  })

  it('rejects an oversized optimizer result before returning image data', async () => {
    const result = await processReadImage(
      largePng,
      'image/png',
      { maxEncodedBytes: 4 },
      { optimize: async () => optimizedImage({ bytes: new Uint8Array([1, 2, 3]) }) },
    )

    expect(result).toEqual({
      ok: false,
      code: 'image_size_limit_exceeded',
      message: '[Image omitted: image_size_limit_exceeded: Encoded image is 4 bytes; limit is 4 bytes.]',
    })
  })

  it('passes the higher-resolution defaults and encoded-size guard to the optimizer', async () => {
    let receivedLimits: ImageResizeLimits | undefined
    const result = await processReadImage(largePng, 'image/png', {}, {
      optimize: async (_bytes, _mimeType, limits) => {
        receivedLimits = limits
        return optimizedImage()
      },
    })

    expect(result.ok).toBe(true)
    expect(receivedLimits).toEqual({
      maxWidth: 2560,
      maxHeight: 2560,
      maxEncodedBytes: 4.5 * 1024 * 1024,
      jpegQuality: 85,
    })
  })

  it('reports format conversion, static GIF fallback, and resized dimensions', async () => {
    const result = await processReadImage(largePng, 'image/gif', {}, {
      optimize: async () => optimizedImage({ mimeType: 'image/jpeg' }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hints.join('\n')).toContain('converted from image/gif to image/jpeg')
      expect(result.hints.join('\n')).toContain('first decoded frame')
      expect(result.hints.join('\n')).toContain('original 2700x1')
      expect(result.hints.join('\n')).toContain('displayed at 2560x1')
    }
  })

  it('resizes a real oversized image through the source Worker path', async () => {
    const result = await processReadImage(largePng, 'image/png')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mimeType).toBe('image/png')
      expect(result.hints.join('\n')).toContain('original 2700x1')
      expect(result.hints.join('\n')).toContain('displayed at 2560x1')
    }
  })
})
