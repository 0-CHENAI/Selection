import { describe, expect, it } from 'bun:test'
import { isHeicFilePath, resolveFileOpenRoute } from '../file-open-route'

describe('resolveFileOpenRoute', () => {
  it('opens ordinary images in the preview overlay', async () => {
    expect(await resolveFileOpenRoute('shot.png', async () => {
      throw new Error('should not probe jpeg')
    })).toEqual({ kind: 'preview', type: 'image' })
  })

  it('previews HEIC when JPEG transcode succeeds', async () => {
    expect(await resolveFileOpenRoute('IMG_0001.HEIC', async () => true)).toEqual({
      kind: 'preview',
      type: 'image',
    })
  })

  it('falls back to the system opener when HEIC transcode fails', async () => {
    expect(await resolveFileOpenRoute('photo.heif', async () => false)).toEqual({ kind: 'external' })
    expect(await resolveFileOpenRoute('D:\\photos\\IMG_0001.HEIC', async () => {
      throw new Error('module not found')
    })).toEqual({ kind: 'external' })
  })

  it('still routes non-previewable files externally', async () => {
    expect(await resolveFileOpenRoute('report.docx', async () => true)).toEqual({ kind: 'external' })
  })
})

describe('isHeicFilePath', () => {
  it('matches heic/heif names across path separators', () => {
    expect(isHeicFilePath('IMG_0001.HEIC')).toBe(true)
    expect(isHeicFilePath('C:\\photos\\img.heif')).toBe(true)
    expect(isHeicFilePath('photo.jpg')).toBe(false)
  })
})
