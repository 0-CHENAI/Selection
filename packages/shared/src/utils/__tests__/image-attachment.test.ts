import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAttachedImagePrompt, originalAttachmentFileName } from '../image-attachment'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const id = '11111111-1111-4111-8111-111111111111'

describe('attached image prompt', () => {
  test('names the original sibling and includes its path only when that file exists', () => {
    expect(originalAttachmentFileName(`${id}_pasted-image-1.png`)).toBe(`${id}_pasted-image-1.original.png`)

    const root = mkdtempSync(join(tmpdir(), 'selection-image-prompt-'))
    dirs.push(root)
    const attachments = join(root, 'attachments')
    mkdirSync(attachments)
    const stored = join(attachments, `${id}_pasted-image-1.png`)
    const original = join(attachments, `${id}_pasted-image-1.original.png`)
    writeFileSync(stored, 'small')
    writeFileSync(original, 'full')

    const prompt = buildAttachedImagePrompt({
      name: 'pasted-image-1.png',
      storedPath: stored,
      originalPath: original,
      originalWidth: 5120,
      originalHeight: 2880,
      sentWidth: 2730,
      sentHeight: 1536,
    })

    expect(prompt).toBe(
      [
        '[Attached image: pasted-image-1.png]',
        `The image is included as visual input — look at it. Path: ${stored}`,
        'Sent to the model at 2730x1536.',
        `Original full-resolution file for cropping/zooming: ${original} (5120x2880)`,
      ].join('\n'),
    )
  })

  test('omits the original line when the image was not resized', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-image-prompt-'))
    dirs.push(root)
    const stored = join(root, 'attachments', `${id}_pasted-image-1.png`)
    mkdirSync(join(root, 'attachments'), { recursive: true })
    writeFileSync(stored, 'small')

    const prompt = buildAttachedImagePrompt({
      name: 'pasted-image-1.png',
      storedPath: stored,
    })

    expect(prompt).toBe(
      [
        '[Attached image: pasted-image-1.png]',
        `The image is included as visual input — look at it. Path: ${stored}`,
      ].join('\n'),
    )
    expect(prompt).not.toContain('Original full-resolution')
  })
})
