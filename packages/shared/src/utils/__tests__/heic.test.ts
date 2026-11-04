import { describe, expect, it } from 'bun:test'
import { convertHeicToJpeg, isHeicBuffer, isHeicImage } from '../heic.ts'

function ftyp(brand: string): Buffer {
  const buf = Buffer.alloc(12)
  buf.writeUInt32BE(0, 0)
  buf.write('ftyp', 4)
  buf.write(brand, 8)
  return buf
}

describe('isHeicBuffer', () => {
  it('recognizes HEIC/HEIF brands', () => {
    expect(isHeicBuffer(ftyp('heic'))).toBe(true)
    expect(isHeicBuffer(ftyp('heif'))).toBe(true)
    expect(isHeicBuffer(ftyp('mif1'))).toBe(true)
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
  })
})

describe('convertHeicToJpeg', () => {
  it('returns JPEG bytes from the injected converter', async () => {
    const jpeg = Buffer.from('fake-jpeg')
    const out = await convertHeicToJpeg(ftyp('heic'), async () => jpeg)
    expect(out.equals(jpeg)).toBe(true)
  })
})
