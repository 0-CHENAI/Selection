import { afterEach, describe, expect, it } from 'bun:test'
import { clearConvertedHeicCache, convertHeicToJpeg, heicCacheKey, isHeicBuffer, isHeicFileName, isHeicImage, peekConvertedHeic, tryConvertHeicToJpeg } from '../heic.ts'

function ftyp(major: string, compatible: string[] = []): Buffer {
  const boxSize = 16 + compatible.length * 4
  const buf = Buffer.alloc(boxSize)
  buf.writeUInt32BE(boxSize, 0)
  buf.write('ftyp', 4)
  buf.write(major.padEnd(4, ' ').slice(0, 4), 8)
  buf.writeUInt32BE(0, 12)
  compatible.forEach((brand, index) => {
    buf.write(brand.padEnd(4, ' ').slice(0, 4), 16 + index * 4)
  })
  return buf
}

afterEach(() => {
  clearConvertedHeicCache()
})

describe('isHeicBuffer', () => {
  it('recognizes HEIC/HEIF brands and mif1 only with a HEIC compatible brand', () => {
    expect(isHeicBuffer(ftyp('heic'))).toBe(true)
    expect(isHeicBuffer(ftyp('heif'))).toBe(true)
    expect(isHeicBuffer(ftyp('mif1', ['heic']))).toBe(true)
    expect(isHeicBuffer(ftyp('mif1', ['hevc']))).toBe(true)
    expect(isHeicBuffer(ftyp('mif1'))).toBe(false)
    expect(isHeicBuffer(ftyp('mif1', ['avif']))).toBe(false)
    expect(isHeicBuffer(ftyp('avif'))).toBe(false)
    expect(isHeicBuffer(Buffer.from('not-heic'))).toBe(false)
  })
})

describe('isHeicImage', () => {
  it('matches mime, extension, or magic bytes', () => {
    expect(isHeicImage({ mimeType: 'image/heic' })).toBe(true)
    expect(isHeicImage({ mimeType: 'image/heif' })).toBe(true)
    expect(isHeicImage({ name: 'IMG_0001.HEIC' })).toBe(true)
    expect(isHeicImage({ name: 'photo.jpg' })).toBe(false)
    expect(isHeicImage({ bytes: ftyp('heic') })).toBe(true)
    expect(isHeicImage({ mimeType: 'image/jpeg', name: 'a.jpg' })).toBe(false)
    expect(isHeicFileName('C:\\photos\\img.heif')).toBe(true)
  })
})

describe('convertHeicToJpeg', () => {
  it('returns JPEG bytes from the injected converter', async () => {
    const jpeg = Buffer.from('fake-jpeg')
    const out = await convertHeicToJpeg(ftyp('heic'), async () => jpeg)
    expect(out.equals(jpeg)).toBe(true)
  })

  it('caches converted JPEGs for preview/thumbnail reuse', async () => {
    let calls = 0
    const jpeg = Buffer.from('cached-jpeg')
    const bytes = ftyp('heic')
    const key = heicCacheKey('/tmp/IMG_0001.HEIC', bytes)
    const first = await convertHeicToJpeg(bytes, async () => {
      calls += 1
      return jpeg
    }, key)
    const second = await convertHeicToJpeg(bytes, async () => {
      calls += 1
      return Buffer.from('other')
    }, key)
    expect(first.equals(jpeg)).toBe(true)
    expect(second.equals(jpeg)).toBe(true)
    expect(calls).toBe(1)
    expect(peekConvertedHeic(key)?.equals(jpeg)).toBe(true)
  })

  it('returns null instead of throwing when conversion fails', async () => {
    expect(await tryConvertHeicToJpeg(ftyp('heic'), async () => {
      throw new Error('missing wasm')
    })).toBeNull()
  })
})
