import { describe, expect, it } from 'bun:test'
import { applyExifOrientation } from './exif-orientation.ts'
import { optimizeImageInProcess } from './image-resize-core.ts'
import type { ImageResizeLimits } from './image-resize-types.ts'
import type { PhotonImageLike, PhotonModuleLike } from './photon-runtime.ts'

interface FakeScenario {
  width: number
  height: number
  rawPixels?: Uint8Array
  pngBytes?: (width: number, height: number) => number
  jpegBytes: (width: number, height: number, quality: number) => number
}

interface FakeStats {
  decodes: number
  resizeCalls: Array<{ width: number; height: number }>
  pngEncodes: number
  jpegQualities: number[]
  jpegPixels: Uint8Array[]
}

function fakePhoton(scenario: FakeScenario): { photon: PhotonModuleLike; stats: FakeStats } {
  const stats: FakeStats = {
    decodes: 0,
    resizeCalls: [],
    pngEncodes: 0,
    jpegQualities: [],
    jpegPixels: [],
  }

  class FakeImage implements PhotonImageLike {
    constructor(
      private readonly pixels: Uint8Array,
      private readonly width: number,
      private readonly height: number,
    ) {}

    free(): void {}
    get_width(): number { return this.width }
    get_height(): number { return this.height }
    get_raw_pixels(): Uint8Array { return new Uint8Array(this.pixels) }
    get_bytes(): Uint8Array {
      stats.pngEncodes += 1
      return new Uint8Array(scenario.pngBytes?.(this.width, this.height) ?? 1)
    }
    get_bytes_jpeg(quality: number): Uint8Array {
      stats.jpegQualities.push(quality)
      stats.jpegPixels.push(new Uint8Array(this.pixels))
      return new Uint8Array(scenario.jpegBytes(this.width, this.height, quality))
    }
  }

  class FakePhotonImage extends FakeImage {
    static new_from_byteslice(): PhotonImageLike {
      stats.decodes += 1
      return new FakePhotonImage(
        scenario.rawPixels ?? new Uint8Array([0, 0, 0, 255]),
        scenario.width,
        scenario.height,
      )
    }
  }

  const photon = {
    PhotonImage: FakePhotonImage,
    SamplingFilter: { Lanczos3: 5 },
    resize(_image: PhotonImageLike, width: number, height: number) {
      stats.resizeCalls.push({ width, height })
      return new FakePhotonImage(
        scenario.rawPixels ?? new Uint8Array([0, 0, 0, 255]),
        width,
        height,
      )
    },
    fliph() {},
    flipv() {},
  } as unknown as PhotonModuleLike

  return { photon, stats }
}

function limits(overrides: Partial<ImageResizeLimits> = {}): ImageResizeLimits {
  return {
    maxWidth: 2560,
    maxHeight: 2560,
    maxEncodedBytes: 1000,
    jpegQuality: 85,
    ...overrides,
  }
}

function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const payload = Buffer.alloc(32)
  payload.write('Exif\0\0', 0, 'binary')
  payload.write('II', 6, 'ascii')
  payload.writeUInt16LE(0x2a, 8)
  payload.writeUInt32LE(8, 10)
  payload.writeUInt16LE(1, 14)
  payload.writeUInt16LE(0x0112, 16)
  payload.writeUInt16LE(3, 18)
  payload.writeUInt32LE(1, 20)
  payload.writeUInt16LE(orientation, 24)
  payload.writeUInt32LE(0, 28)

  const segment = Buffer.alloc(payload.length + 4)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(payload.length + 2, 2)
  payload.copy(segment, 4)
  return Buffer.concat([Buffer.from(jpeg.subarray(0, 2)), segment, Buffer.from(jpeg.subarray(2))])
}

function withXmpBeforeExif(jpeg: Uint8Array, orientation: number): Uint8Array {
  const withExif = withExifOrientation(jpeg, orientation)
  const payload = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>', 'utf8')
  const segment = Buffer.alloc(payload.length + 4)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(payload.length + 2, 2)
  payload.copy(segment, 4)
  return Buffer.concat([withExif.subarray(0, 2), segment, withExif.subarray(2)])
}

describe('adaptive Pi read image optimizer', () => {
  it('uses a single JPEG 85 encoding when it already fits', async () => {
    const { photon, stats } = fakePhoton({
      width: 2560,
      height: 1,
      jpegBytes: () => 600,
    })

    const result = await optimizeImageInProcess(new Uint8Array([1]), 'image/jpeg', limits(), {
      loadPhoton: async () => photon,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.jpegQuality).toBe(85)
      expect(result.encodingAttempts).toBe(1)
    }
    expect(stats.decodes).toBe(1)
    expect(stats.jpegQualities).toEqual([85])
  })

  it('binary-searches the highest JPEG quality between 70 and 85', async () => {
    const { photon, stats } = fakePhoton({
      width: 2560,
      height: 1,
      jpegBytes: (_width, _height, quality) => quality <= 78 ? 600 : 900,
    })

    const result = await optimizeImageInProcess(new Uint8Array([1]), 'image/jpeg', limits(), {
      loadPhoton: async () => photon,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.jpegQuality).toBe(78)
    expect(stats.jpegQualities).toContain(85)
    expect(stats.jpegQualities).toContain(70)
    expect(stats.jpegQualities.every(quality => quality >= 70)).toBe(true)
    expect(stats.jpegQualities).not.toContain(55)
    expect(stats.jpegQualities).not.toContain(40)
  })

  it('uses an adaptive dimension step instead of dropping 2560px to 1920px', async () => {
    const { photon, stats } = fakePhoton({
      width: 2560,
      height: 1,
      jpegBytes: width => width === 2560 ? 900 : 600,
    })

    const result = await optimizeImageInProcess(new Uint8Array([1]), 'image/jpeg', limits(), {
      loadPhoton: async () => photon,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.width).toBeGreaterThan(1920)
      expect(result.width).toBeLessThan(2560)
      expect(result.resizePasses).toBe(2)
    }
    expect(stats.jpegQualities).toEqual([85, 70, 85])
  })

  it('keeps a PNG source lossless when PNG fits', async () => {
    const { photon, stats } = fakePhoton({
      width: 2560,
      height: 1,
      pngBytes: () => 600,
      jpegBytes: () => 100,
    })

    const result = await optimizeImageInProcess(new Uint8Array([1]), 'image/png', limits(), {
      loadPhoton: async () => photon,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.mimeType).toBe('image/png')
    expect(stats.pngEncodes).toBe(1)
    expect(stats.jpegQualities).toEqual([])
  })

  it('composites transparent pixels onto white before JPEG fallback', async () => {
    const { photon, stats } = fakePhoton({
      width: 1,
      height: 1,
      rawPixels: new Uint8Array([0, 0, 0, 0]),
      pngBytes: () => 900,
      jpegBytes: () => 600,
    })

    const result = await optimizeImageInProcess(new Uint8Array([1]), 'image/png', limits(), {
      loadPhoton: async () => photon,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.mimeType).toBe('image/jpeg')
    expect(stats.jpegPixels[0]).toEqual(new Uint8Array([255, 255, 255, 255]))
  })

  it('applies EXIF orientation before choosing output dimensions', async () => {
    const photon = await import('@silvia-odwyer/photon-node')
    const source = new photon.PhotonImage(new Uint8Array([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]), 2, 1)
    let jpeg: Uint8Array
    try {
      jpeg = source.get_bytes_jpeg(90)
    } finally {
      source.free()
    }

    const result = await optimizeImageInProcess(
      withExifOrientation(jpeg, 6),
      'image/jpeg',
      limits({ maxWidth: 100, maxHeight: 100, maxEncodedBytes: 4.5 * 1024 * 1024 }),
      { loadPhoton: async () => photon as unknown as PhotonModuleLike },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.originalWidth).toBe(1)
      expect(result.originalHeight).toBe(2)
      expect(result.width).toBe(1)
      expect(result.height).toBe(2)
    }
  })

  it('applies all EXIF orientation transforms with the expected pixel layout', async () => {
    const photon = await import('@silvia-odwyer/photon-node')
    const expected = [
      { width: 2, height: 3, pixels: [1, 2, 3, 4, 5, 6] },
      { width: 2, height: 3, pixels: [2, 1, 4, 3, 6, 5] },
      { width: 2, height: 3, pixels: [6, 5, 4, 3, 2, 1] },
      { width: 2, height: 3, pixels: [5, 6, 3, 4, 1, 2] },
      { width: 3, height: 2, pixels: [1, 3, 5, 2, 4, 6] },
      { width: 3, height: 2, pixels: [5, 3, 1, 6, 4, 2] },
      { width: 3, height: 2, pixels: [6, 4, 2, 5, 3, 1] },
      { width: 3, height: 2, pixels: [2, 4, 6, 1, 3, 5] },
    ]

    for (const [index, transformed] of expected.entries()) {
      const pixels = new Uint8Array(6 * 4)
      for (let pixel = 0; pixel < 6; pixel += 1) {
        pixels[pixel * 4] = pixel + 1
        pixels[pixel * 4 + 3] = 255
      }
      const source = new photon.PhotonImage(pixels, 2, 3)
      const oriented = applyExifOrientation(
        photon as unknown as PhotonModuleLike,
        source,
        withExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), index + 1),
      )
      try {
        expect(oriented.get_width()).toBe(transformed.width)
        expect(oriented.get_height()).toBe(transformed.height)
        const actualPixels = Array.from(oriented.get_raw_pixels())
          .filter((_value, channel) => channel % 4 === 0)
        expect(actualPixels).toEqual(transformed.pixels)
      } finally {
        if (oriented !== source) oriented.free()
        source.free()
      }
    }
  })

  it('finds EXIF orientation after an earlier non-EXIF APP1 segment', async () => {
    const photon = await import('@silvia-odwyer/photon-node')
    const source = new photon.PhotonImage(new Uint8Array([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]), 2, 1)
    let jpeg: Uint8Array
    try {
      jpeg = source.get_bytes_jpeg(90)
    } finally {
      source.free()
    }

    const result = await optimizeImageInProcess(
      withXmpBeforeExif(jpeg, 6),
      'image/jpeg',
      limits({ maxWidth: 100, maxHeight: 100, maxEncodedBytes: 4.5 * 1024 * 1024 }),
      { loadPhoton: async () => photon as unknown as PhotonModuleLike },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.originalWidth).toBe(1)
      expect(result.originalHeight).toBe(2)
    }
  })

  it('stops after six resize passes and never emits JPEG below quality 70', async () => {
    const { photon, stats } = fakePhoton({
      width: 2560,
      height: 2560,
      jpegBytes: () => 10_000,
    })

    const result = await optimizeImageInProcess(new Uint8Array([1]), 'image/jpeg', limits(), {
      loadPhoton: async () => photon,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('image_size_limit_exceeded')
    expect(stats.decodes).toBe(1)
    expect(stats.resizeCalls).toHaveLength(5)
    expect(stats.jpegQualities).toHaveLength(12)
    expect(stats.jpegQualities.every(quality => quality >= 70)).toBe(true)
  })

  it('distinguishes runtime, decode, conversion, and resize failures', async () => {
    const runtime = await optimizeImageInProcess(new Uint8Array([1]), 'image/jpeg', limits(), {
      loadPhoton: async () => { throw new Error('missing wasm') },
    })
    expect(runtime.ok ? '' : runtime.code).toBe('image_runtime_unavailable')

    const decoded = fakePhoton({ width: 1, height: 1, jpegBytes: () => 1 })
    decoded.photon.PhotonImage.new_from_byteslice = () => { throw new Error('bad image') }
    const decode = await optimizeImageInProcess(new Uint8Array([1]), 'image/jpeg', limits(), {
      loadPhoton: async () => decoded.photon,
    })
    expect(decode.ok ? '' : decode.code).toBe('image_decode_failed')

    const converted = fakePhoton({ width: 1, height: 1, pngBytes: () => 1, jpegBytes: () => 1 })
    const convertedImage = converted.photon.PhotonImage.new_from_byteslice(new Uint8Array([1]))
    convertedImage.get_bytes = () => { throw new Error('encode failed') }
    converted.photon.PhotonImage.new_from_byteslice = () => convertedImage
    const conversion = await optimizeImageInProcess(new Uint8Array([1]), 'image/png', limits(), {
      loadPhoton: async () => converted.photon,
    })
    expect(conversion.ok ? '' : conversion.code).toBe('image_conversion_failed')

    const resized = fakePhoton({ width: 3000, height: 1, jpegBytes: () => 1 })
    resized.photon.resize = () => { throw new Error('resize failed') }
    const resize = await optimizeImageInProcess(new Uint8Array([1]), 'image/jpeg', limits(), {
      loadPhoton: async () => resized.photon,
    })
    expect(resize.ok ? '' : resize.code).toBe('image_resize_failed')
  })
})
