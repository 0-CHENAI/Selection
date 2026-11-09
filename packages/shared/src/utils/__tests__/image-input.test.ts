import { describe, expect, it } from 'bun:test'
import { describeImageAttachment, describePromptImages, digestImageBase64, isImageLike } from '../image-input'

const pngBase64 = Buffer.from('png-bytes').toString('base64')

describe('image-input diagnostics', () => {
  it('hashes image bytes without exposing the original payload', () => {
    const digest = digestImageBase64(pngBase64)
    expect(digest.byteLength).toBe(9)
    expect(digest.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(digest)).not.toContain(pngBase64)
    expect(JSON.stringify(digest)).not.toContain('png-bytes')
  })

  it('is stable across repeated digest calls', () => {
    const first = digestImageBase64(pngBase64)
    for (let i = 0; i < 20; i++) {
      expect(digestImageBase64(pngBase64)).toEqual(first)
    }
  })

  it('describes attachments and prompt images without raw bytes', () => {
    const attachment = describeImageAttachment({
      name: 'shot.png',
      mimeType: 'image/png',
      base64: pngBase64,
    })
    const prompts = describePromptImages([{ mimeType: 'image/png', data: pngBase64 }])

    expect(isImageLike({ type: 'image', mimeType: 'image/png' })).toBe(true)
    expect(attachment.hasBytes).toBe(true)
    expect(attachment.sha256).toBe(digestImageBase64(pngBase64).sha256)
    expect(JSON.stringify(attachment)).not.toContain(pngBase64)
    expect(prompts[0]?.hasBytes).toBe(true)
    expect(JSON.stringify(prompts)).not.toContain(pngBase64)
  })
})
