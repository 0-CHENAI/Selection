import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { fileAttachmentsFromStored, getFileType, getMimeType, hydrateAttachmentBytes, imageAttachmentsMissingBytes, readFileAttachment, resolveRegenerateAttachments, withStoredImagePaths } from '../files'

const cleanups: Array<() => void> = []

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'files-test-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c()
    } catch {
      // best-effort
    }
  }
})

// ---------------------------------------------------------------------------
// Regression for #719: audio extensions must NOT fall through to 'text'.
// ---------------------------------------------------------------------------

describe('getFileType — audio support', () => {
  test('voice note .ogg → audio (regression for default-to-text fallthrough)', () => {
    expect(getFileType('voice.ogg')).toBe('audio')
  })

  test('mp3 → audio', () => {
    expect(getFileType('song.mp3')).toBe('audio')
  })

  test('m4a → audio', () => {
    expect(getFileType('clip.m4a')).toBe('audio')
  })

  test('wav → audio', () => {
    expect(getFileType('beep.wav')).toBe('audio')
  })

  test('opus → audio', () => {
    expect(getFileType('voice.opus')).toBe('audio')
  })

  test('non-audio still resolves correctly (regression guard)', () => {
    expect(getFileType('file.txt')).toBe('text')
    expect(getFileType('image.png')).toBe('image')
    expect(getFileType('doc.pdf')).toBe('pdf')
    expect(getFileType('sheet.xlsx')).toBe('office')
  })
})

describe('getMimeType — audio support', () => {
  test('ogg → audio/ogg', () => {
    expect(getMimeType('voice.ogg')).toBe('audio/ogg')
  })

  test('mp3 → audio/mpeg', () => {
    expect(getMimeType('song.mp3')).toBe('audio/mpeg')
  })

  test('opus → audio/ogg', () => {
    expect(getMimeType('voice.opus')).toBe('audio/ogg')
  })
})

describe('readFileAttachment — audio fixture', () => {
  test('returns an audio attachment with base64 populated', () => {
    const dir = makeTmp()
    const path = join(dir, 'voice.ogg')
    const bytes = Buffer.from('fake-ogg-bytes')
    writeFileSync(path, bytes)

    const att = readFileAttachment(path)
    expect(att).not.toBeNull()
    expect(att?.type).toBe('audio')
    expect(att?.mimeType).toBe('audio/ogg')
    expect(att?.base64).toBe(bytes.toString('base64'))
    expect(att?.text).toBeUndefined()
    expect(att?.size).toBe(bytes.byteLength)
  })

  test('returns text attachment for .txt — regression guard', () => {
    const dir = makeTmp()
    const path = join(dir, 'note.txt')
    writeFileSync(path, 'hello world')

    const att = readFileAttachment(path)
    expect(att).not.toBeNull()
    expect(att?.type).toBe('text')
    expect(att?.text).toBe('hello world')
    expect(att?.base64).toBeUndefined()
  })
})

describe('fileAttachmentsFromStored', () => {
  test('rebuilds path-based FileAttachments and prefers resized base64', () => {
    const rebuilt = fileAttachmentsFromStored([{
      type: 'image',
      name: 'shot.png',
      mimeType: 'image/png',
      size: 12,
      storedPath: '/tmp/session/shot.png',
      resizedBase64: 'resized',
    }])

    expect(rebuilt).toEqual([{
      type: 'image',
      path: '/tmp/session/shot.png',
      name: 'shot.png',
      mimeType: 'image/png',
      size: 12,
      base64: 'resized',
      storedPath: '/tmp/session/shot.png',
      markdownPath: undefined,
    }])
  })

  test('returns undefined when nothing was persisted', () => {
    expect(fileAttachmentsFromStored(undefined)).toBeUndefined()
    expect(fileAttachmentsFromStored([])).toBeUndefined()
  })
})

describe('withStoredImagePaths', () => {
  test('fills storedPath onto path-only live attachments', () => {
    const merged = withStoredImagePaths(
      [{
        type: 'image',
        path: '/tmp/original.png',
        name: 'shot.png',
        mimeType: 'image/png',
        size: 12,
      }],
      [{
        type: 'image',
        name: 'shot.png',
        mimeType: 'image/png',
        size: 12,
        storedPath: '/tmp/session/shot.png',
      }],
    )

    expect(merged?.[0]?.storedPath).toBe('/tmp/session/shot.png')
  })

  test('leaves attachments that already have bytes unchanged', () => {
    const live = [{
      type: 'image' as const,
      path: '/tmp/original.png',
      name: 'shot.png',
      mimeType: 'image/png',
      size: 12,
      base64: 'live',
    }]
    expect(withStoredImagePaths(live, [{
      type: 'image',
      name: 'shot.png',
      mimeType: 'image/png',
      size: 12,
      storedPath: '/tmp/session/shot.png',
    }])).toEqual(live)
  })
})

describe('resolveRegenerateAttachments', () => {
  const stored = [{
    type: 'image' as const,
    name: 'shot.png',
    mimeType: 'image/png',
    size: 12,
    storedPath: '/tmp/session/shot.png',
  }]
  const lastSent = [{
    type: 'image' as const,
    path: '/tmp/original.png',
    name: 'shot.png',
    mimeType: 'image/png',
    size: 12,
    base64: 'live',
  }]

  test('keeps in-memory attachments when the prompt still matches', () => {
    expect(resolveRegenerateAttachments('describe this', lastSent, 'describe this', stored)).toEqual(lastSent)
  })

  test('rebuilds from stored paths after restart or prompt mismatch', () => {
    expect(resolveRegenerateAttachments(undefined, undefined, 'describe this', stored)?.[0]?.path)
      .toBe('/tmp/session/shot.png')
    expect(resolveRegenerateAttachments('other', lastSent, 'describe this', stored)?.[0]?.path)
      .toBe('/tmp/session/shot.png')
  })
})

describe('hydrateAttachmentBytes', () => {
  test('fills missing image base64 from storedPath', () => {
    const dir = makeTmp()
    const path = join(dir, 'shot.png')
    const bytes = Buffer.from('fake-png-bytes')
    writeFileSync(path, bytes)

    const hydrated = hydrateAttachmentBytes([{
      type: 'image',
      path,
      storedPath: path,
      name: 'shot.png',
      mimeType: 'image/png',
      size: bytes.byteLength,
    }])

    expect(hydrated?.[0]?.base64).toBe(bytes.toString('base64'))
  })

  test('leaves attachments that already have base64 unchanged', () => {
    const hydrated = hydrateAttachmentBytes([{
      type: 'image',
      path: '/tmp/shot.png',
      name: 'shot.png',
      mimeType: 'image/png',
      size: 3,
      base64: 'abc',
    }])

    expect(hydrated?.[0]?.base64).toBe('abc')
  })

  test('returns undefined for empty input', () => {
    expect(hydrateAttachmentBytes(undefined)).toBeUndefined()
  })

  test('keeps a path-only image when the file is missing', () => {
    const attachment = {
      type: 'image' as const,
      path: join(makeTmp(), 'missing.png'),
      name: 'missing.png',
      mimeType: 'image/png',
      size: 1,
    }
    expect(hydrateAttachmentBytes([attachment])).toEqual([attachment])
  })

  test('reports images that still lack bytes after hydrate', () => {
    const attachment = {
      type: 'image' as const,
      path: join(makeTmp(), 'missing.png'),
      name: 'missing.png',
      mimeType: 'image/png',
      size: 1,
    }
    expect(imageAttachmentsMissingBytes(hydrateAttachmentBytes([attachment]))).toEqual([attachment])
    expect(imageAttachmentsMissingBytes([{
      ...attachment,
      base64: 'abc',
    }])).toEqual([])
  })

  test('keeps a path-only image when the file is over the size limit', () => {
    const dir = makeTmp()
    const path = join(dir, 'huge.png')
    writeFileSync(path, Buffer.alloc(21 * 1024 * 1024))
    const attachment = {
      type: 'image' as const,
      path,
      storedPath: path,
      name: 'huge.png',
      mimeType: 'image/png',
      size: 21 * 1024 * 1024,
    }
    expect(hydrateAttachmentBytes([attachment])).toEqual([attachment])
  })
})
