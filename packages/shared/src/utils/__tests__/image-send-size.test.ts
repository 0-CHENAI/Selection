import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_DEEPSEEK_IMAGE_MAX_BYTES,
  DEFAULT_IMAGE_MAX_BYTES,
  DEFAULT_IMAGE_MAX_DIMENSION,
  DEFAULT_IMAGE_PIXEL_BUDGET,
  deepSeekImageTokens,
  deepSeekRequestImageDimensions,
  encodingMediaType,
  longEdgeDimensions,
  requestImageDimensions,
  resolveImageSendPolicy,
  resolveImageSendSize,
} from '../image-send-size'

describe('request image dimensions', () => {
  it.each([
    [4096, 4096, 800, 800],
    [4096, 2048, 1130, 565],
    [3840, 2160, 1066, 600],
    [320, 240, 320, 240],
  ])('projects %sx%s under 640,000 pixels as %sx%s', (width, height, expectedWidth, expectedHeight) => {
    const projected = requestImageDimensions(width, height, 640_000)
    expect(projected).toEqual({ width: expectedWidth, height: expectedHeight })
    expect(projected.width * projected.height).toBeLessThanOrEqual(640_000)
  })

  it('projects a portrait within the same total-pixel budget', () => {
    const projected = requestImageDimensions(2160, 3840, 640_000)
    expect(projected).toEqual({ width: 600, height: 1066 })
    expect(projected.width * projected.height).toBeLessThanOrEqual(640_000)
  })

  it('rounds a portrait inward when integer aspect rounding crosses the pixel cap', () => {
    expect(requestImageDimensions(2, 4, 5)).toEqual({ width: 1, height: 2 })
  })

  it('keeps a wide image inside 2048² without clipping the short edge to a long-edge rule', () => {
    const projected = requestImageDimensions(5120, 2880, DEFAULT_IMAGE_PIXEL_BUDGET)
    expect(projected).toEqual({ width: 2730, height: 1536 })
    expect(projected.width * projected.height).toBeLessThanOrEqual(DEFAULT_IMAGE_PIXEL_BUDGET)
    expect(projected.width).toBeGreaterThan(1568)
  })

  it('keeps a tall image inside the same budget', () => {
    const projected = requestImageDimensions(2880, 5120, DEFAULT_IMAGE_PIXEL_BUDGET)
    expect(projected).toEqual({ width: 1536, height: 2730 })
    expect(projected.width * projected.height).toBeLessThanOrEqual(DEFAULT_IMAGE_PIXEL_BUDGET)
  })

  it('does not enlarge an image that already fits', () => {
    expect(requestImageDimensions(800, 600, DEFAULT_IMAGE_PIXEL_BUDGET)).toEqual({ width: 800, height: 600 })
  })
})

describe('long-edge dimensions', () => {
  it('keeps the long edge exact and rounds the short edge', () => {
    expect(longEdgeDimensions(8000, 40, 4096)).toEqual({ width: 4096, height: 20 })
    expect(longEdgeDimensions(10_000, 100, 4096)).toEqual({ width: 4096, height: 41 })
    expect(longEdgeDimensions(1080, 2400, 1862)).toEqual({ width: 838, height: 1862 })
    expect(longEdgeDimensions(1, 9000, 4096)).toEqual({ width: 1, height: 4096 })
  })

  it('never enlarges a source at or below the long edge', () => {
    expect(longEdgeDimensions(320, 240, 320)).toEqual({ width: 320, height: 240 })
    expect(longEdgeDimensions(320, 240, 4096)).toEqual({ width: 320, height: 240 })
  })
})

describe('send size policy', () => {
  it('uses the 2048² budget, 8192 long edge, and 4MiB byte target by default', () => {
    const policy = resolveImageSendPolicy()
    expect(policy).toEqual({
      mode: 'pixel-budget',
      pixelBudget: DEFAULT_IMAGE_PIXEL_BUDGET,
      maxDimension: DEFAULT_IMAGE_MAX_DIMENSION,
      maxBytes: DEFAULT_IMAGE_MAX_BYTES,
    })
    expect(resolveImageSendSize(100, 50, policy)).toEqual({ width: 100, height: 50 })
    expect(resolveImageSendSize(5120, 2880, policy)).toEqual({ width: 2730, height: 1536 })
    expect(resolveImageSendSize(10000, 100, policy)).toEqual({ width: 8192, height: 82 })
    expect(resolveImageSendSize(1, 9000, policy)).toEqual({ width: 1, height: 8192 })
  })

  it('honors connection overrides and does not match on a model name', () => {
    const policy = resolveImageSendPolicy({
      imagePixelBudget: 640_000,
      imageMaxBytes: 1234,
      imageMaxDimension: 4096,
      piAuthProvider: 'openai',
      baseUrl: 'https://api.deepseek.com.example/v1',
    })
    expect(policy.mode).toBe('pixel-budget')
    expect(policy.maxBytes).toBe(1234)
    expect(resolveImageSendSize(3840, 2160, policy)).toEqual({ width: 1066, height: 600 })
  })

  it('selects WebP only when the image has an alpha channel', () => {
    expect(encodingMediaType(true)).toBe('image/webp')
    expect(encodingMediaType(false)).toBe('image/jpeg')
  })
})

describe('DeepSeek image tokens', () => {
  it.each([
    [100, 100, 184],
    [544, 544, 184],
    [640, 480, 206],
    [800, 800, 422],
    [1024, 768, 496],
    [1066, 600, 407],
    [1300, 1300, 994],
    [1920, 1080, 968],
    [2000, 2000, 994],
    [5000, 5000, 994],
    [300, 50, 200],
    [8192, 100, 593],
    [16, 8192, 590],
  ])('prices %sx%s as %s tokens', (width, height, expected) => {
    expect(deepSeekImageTokens(width, height)).toBe(expected)
  })

  it('caps every image at 1024 tokens regardless of source size', () => {
    for (const [width, height] of [[2000, 2000], [5000, 5000], [8192, 8192], [16, 8192], [9000, 1], [1, 9000]]) {
      expect(deepSeekImageTokens(width!, height!)).toBeLessThanOrEqual(1024)
    }
  })

  it('prices small images at the documented scale-up floor', () => {
    expect(deepSeekImageTokens(100, 100)).toBe(deepSeekImageTokens(544, 544))
  })

  it('solves a one-row grid for an extremely wide image and a one-column grid for a tall one', () => {
    expect(deepSeekImageTokens(9000, 1)).toBe(1024)
    expect(deepSeekImageTokens(1, 9000)).toBe(1024)
  })

  it('converges through repeated projection passes when the first is not a fixpoint', () => {
    expect(deepSeekImageTokens(12, 1123)).toBe(380)
    expect(deepSeekImageTokens(89, 2076)).toBe(254)
  })
})

describe('DeepSeek request image dimensions', () => {
  it('can cross a token-cell boundary when preserving the source aspect ratio', () => {
    const sent = deepSeekRequestImageDimensions(1224, 1429)
    expect(sent).toEqual({ width: 1187, height: 1386 })
    expect(deepSeekImageTokens(1224, 1429)).toBe(959)
    expect(deepSeekImageTokens(sent.width, sent.height)).toBe(992)
  })

  it.each([
    [800, 800, 800, 800],
    [1302, 1302, 1302, 1302],
    [8192, 78, 8192, 78],
    [1, 9000, 1, 9000],
  ])('sends %sx%s unchanged because its padded grid fits the cap', (width, height, expectedWidth, expectedHeight) => {
    expect(deepSeekRequestImageDimensions(width, height)).toEqual({ width: expectedWidth, height: expectedHeight })
  })

  it.each([
    [1303, 1303, 1302, 1302],
    [2048, 2048, 1302, 1302],
    [2048, 1024, 1848, 924],
    [3840, 2160, 1708, 961],
    [1080, 2400, 838, 1862],
  ])('downscales %sx%s to %sx%s at the solved long edge', (width, height, expectedWidth, expectedHeight) => {
    const sent = deepSeekRequestImageDimensions(width, height)
    expect(sent).toEqual({ width: expectedWidth, height: expectedHeight })
    expect(deepSeekImageTokens(sent.width, sent.height)).toBe(deepSeekImageTokens(width, height))
  })

  it('uses the token grid for a DeepSeek connection and caps a 1x9000 image at 8192', () => {
    const byProvider = resolveImageSendPolicy({ piAuthProvider: 'deepseek' })
    const byHost = resolveImageSendPolicy({ baseUrl: 'https://api.deepseek.com/v1' })
    expect(byProvider.mode).toBe('deepseek-tokens')
    expect(byHost.mode).toBe('deepseek-tokens')
    expect(byProvider.maxBytes).toBe(DEFAULT_DEEPSEEK_IMAGE_MAX_BYTES)
    expect(resolveImageSendSize(2048, 2048, byProvider)).toEqual({ width: 1302, height: 1302 })
    expect(deepSeekImageTokens(1302, 1302)).toBeLessThanOrEqual(1024)
    expect(resolveImageSendSize(1, 9000, byHost)).toEqual({ width: 1, height: 8192 })
    expect(resolveImageSendSize(5120, 2880, byProvider).width).toBeLessThan(2730)
  })

  it('lets an explicit pixel budget opt a DeepSeek connection out of the token grid', () => {
    const policy = resolveImageSendPolicy({
      piAuthProvider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      imagePixelBudget: DEFAULT_IMAGE_PIXEL_BUDGET,
      imageMaxBytes: 3 * 1024 * 1024,
    })
    expect(policy.mode).toBe('pixel-budget')
    expect(policy.maxBytes).toBe(3 * 1024 * 1024)
    expect(resolveImageSendSize(5120, 2880, policy)).toEqual({ width: 2730, height: 1536 })
  })
})
