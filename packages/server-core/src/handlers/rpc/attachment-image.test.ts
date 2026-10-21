import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageProcessor, Logger } from '../../runtime/platform'
import { storeAttachmentImage } from './attachment-image'

const dirs: string[] = []
const logger: Logger = { info() {}, warn() {}, error() {}, debug() {} }
const id = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function processor(size: { width: number; height: number }, resized = Buffer.from('resized')): ImageProcessor & {
  calls: number
  lastOptions?: Parameters<ImageProcessor['process']>[1]
} {
  const impl = {
    calls: 0,
    lastOptions: undefined as Parameters<ImageProcessor['process']>[1],
    getMetadata: async () => size,
    process: async (_input: Buffer | string, options?: Parameters<ImageProcessor['process']>[1]) => {
      impl.calls += 1
      impl.lastOptions = options
      return resized
    },
  }
  return impl
}

describe('storeAttachmentImage', () => {
  test('saves the original only when the image is resized', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-attachment-image-'))
    dirs.push(dir)
    const storedFileName = `${id}_pasted-image-1.png`
    const originalBytes = Buffer.from('full-resolution-png')
    const small = processor({ width: 800, height: 600 })

    const unchanged = await storeAttachmentImage({
      bytes: originalBytes,
      mimeType: 'image/png',
      declaredSize: originalBytes.length,
      attachmentsDir: dir,
      storedFileName,
      processor: small,
      logger,
    })

    expect(unchanged.wasResized).toBe(false)
    expect(unchanged.originalPath).toBeUndefined()
    expect(small.calls).toBe(0)
    expect(readdirSync(dir)).toEqual([storedFileName])
    expect(readFileSync(join(dir, storedFileName))).toEqual(originalBytes)

    const resizedBytes = Buffer.from('downscaled')
    const large = processor({ width: 5120, height: 2880 }, resizedBytes)
    const resizedDir = mkdtempSync(join(tmpdir(), 'selection-attachment-image-'))
    dirs.push(resizedDir)
    const resized = await storeAttachmentImage({
      bytes: originalBytes,
      mimeType: 'image/png',
      declaredSize: originalBytes.length,
      attachmentsDir: resizedDir,
      storedFileName,
      processor: large,
      logger,
    })

    const originalName = `${id}_pasted-image-1.original.png`
    expect(resized.wasResized).toBe(true)
    expect(resized.originalWidth).toBe(5120)
    expect(resized.originalHeight).toBe(2880)
    expect(resized.originalPath).toBe(join(resizedDir, originalName))
    expect(resized.resizedBase64).toBe(resizedBytes.toString('base64'))
    expect(large.calls).toBe(1)
    expect(large.lastOptions).toMatchObject({
      resize: { width: 2730, height: 1536 },
      format: 'webp',
      quality: 85,
      effort: 0,
      normalize: true,
    })
    expect(resized.sentWidth).toBe(2730)
    expect(resized.sentHeight).toBe(1536)
    expect(resized.outputMimeType).toBe('image/webp')
    expect(readdirSync(resizedDir).sort()).toEqual([originalName, storedFileName].sort())
    expect(readFileSync(join(resizedDir, originalName))).toEqual(originalBytes)
    expect(readFileSync(join(resizedDir, storedFileName))).toEqual(resizedBytes)
  })
})
