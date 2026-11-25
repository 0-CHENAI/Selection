import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveImageSendPolicy, resolveImageSendSize } from '@craft-agent/shared/utils'
import type { ImageOptimizationResult, ImageResizeLimits } from './image-resize-types.ts'
import { DEFAULT_JPEG_QUALITY, DEFAULT_MAX_ENCODED_BYTES, DEFAULT_MAX_HEIGHT, DEFAULT_MAX_WIDTH } from './image-resize-types.ts'
import { createSelectionReadToolDefinition } from './create-read-tool.ts'

const tempDirs: string[] = []
const legacyWordFixture = join(import.meta.dir, 'fixtures', 'legacy-word-bilingual.doc')
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('reads legacy Word text with UTF-8 line pagination through the normal Read entry point', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'legacy-word-read-'))
  tempDirs.push(cwd)
  const file = join(cwd, '资料 01.DOC')
  copyFileSync(legacyWordFixture, file)
  const before = readFileSync(file)
  const result = await createSelectionReadToolDefinition(cwd).execute(
    'legacy', { path: '资料 01.DOC', offset: 2, limit: 1 }, undefined, undefined, undefined as never,
  )
  expect(result.content.map(part => part.type === 'text' ? part.text : '')).toEqual([
    'Extracted legacy Word text. Line offsets refer to the extracted text.',
    expect.stringMatching(/^第一季度巡检，设备正常。\n\n.*offset=3/),
  ])
  expect(result.details?.sourceRead).toBeUndefined()
  expect(readFileSync(file)).toEqual(before)
})

it('reports an invalid legacy Word document without returning binary text', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'legacy-word-invalid-'))
  tempDirs.push(cwd)
  writeFileSync(join(cwd, 'malformed.doc'), Buffer.alloc(512))
  const read = createSelectionReadToolDefinition(cwd)
  await expect(read.execute('legacy', { path: 'malformed.doc' }, undefined, undefined, undefined as never))
    .rejects.toThrow('not a Word 97–2003 binary .doc file')
})

it('coalesces consecutive and concurrent Word offsets and invalidates on source change', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'legacy-word-cache-'))
  tempDirs.push(cwd)
  const file = join(cwd, 'source.doc')
  copyFileSync(legacyWordFixture, file)
  const tool = createSelectionReadToolDefinition(cwd)
  const reads = (offset: number) => tool.execute('legacy', { path: file, offset, limit: 1 }, undefined, undefined, undefined as never)
  const spawn = spyOn(Bun, 'spawn')
  try {
    const [a, b] = await Promise.all([reads(1), reads(3)])
    expect(a.content[1]).toMatchObject({ text: expect.stringContaining('Annual report 2026') })
    expect(b.content[1]).toMatchObject({ text: expect.stringContaining('第二季度完成技术监督') })
    await reads(2)
    expect(spawn).toHaveBeenCalledTimes(1)
    utimesSync(file, new Date(), new Date(Date.now() - 5000))
    await reads(3)
    expect(spawn).toHaveBeenCalledTimes(2)
  } finally { spawn.mockRestore() }
})

function imageContext() {
  return {
    model: { input: ['text', 'image'] },
  } as never
}

function onePixelBmp(): Buffer {
  const bmp = Buffer.alloc(58)
  bmp.write('BM', 0, 'ascii')
  bmp.writeUInt32LE(bmp.length, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(1, 18)
  bmp.writeInt32LE(1, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  return bmp
}

function widePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(13, 0)
  const type = Buffer.from('IHDR')
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data[8] = 8
  data[9] = 2
  return Buffer.concat([signature, length, type, data, Buffer.alloc(4)])
}

describe('Selection Pi read tool', () => {
  it('returns a small PNG image without starting the optimizer', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'selection-read-tool-'))
    tempDirs.push(cwd)
    writeFileSync(join(cwd, 'small.png'), png)
    let optimizerCalls = 0
    const tool = createSelectionReadToolDefinition(cwd, undefined, {
      optimize: async (): Promise<ImageOptimizationResult> => {
        optimizerCalls += 1
        throw new Error('should not run')
      },
    })

    const result = await tool.execute('read-1', { path: 'small.png' }, undefined, undefined, imageContext())

    expect(optimizerCalls).toBe(0)
    expect(result.content.some(content => content.type === 'image')).toBe(true)
  })

  it('surfaces runtime_unavailable instead of the SDK size-limit message', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'selection-read-tool-'))
    tempDirs.push(cwd)
    writeFileSync(join(cwd, 'small.png'), png)
    const tool = createSelectionReadToolDefinition(cwd, { maxWidth: 0 }, {
      optimize: async () => ({
        ok: false,
        code: 'image_runtime_unavailable',
        detail: 'Photon could not be loaded: ENOENT: photon_rs_bg.wasm',
      }),
    })

    const result = await tool.execute('read-2', { path: 'small.png' }, undefined, undefined, imageContext())
    const text = result.content.find(content => content.type === 'text')

    expect(result.content.some(content => content.type === 'image')).toBe(false)
    expect(text?.type === 'text' ? text.text : '').toContain('image_runtime_unavailable')
    expect(text?.type === 'text' ? text.text : '').not.toContain('could not be resized below')
  })

  it('passes a non-inline image directly to Selection without a Pi PNG intermediate', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'selection-read-tool-'))
    tempDirs.push(cwd)
    const bmp = onePixelBmp()
    writeFileSync(join(cwd, 'small.bmp'), bmp)
    let receivedBytes: Uint8Array | undefined
    let receivedMimeType: string | undefined
    const tool = createSelectionReadToolDefinition(cwd, undefined, {
      optimize: async (bytes, mimeType) => {
        receivedBytes = new Uint8Array(bytes)
        receivedMimeType = mimeType
        return {
          ok: true,
          bytes: png,
          mimeType: 'image/png',
          originalWidth: 1,
          originalHeight: 1,
          width: 1,
          height: 1,
          wasResized: false,
          encodingAttempts: 1,
          resizePasses: 1,
        }
      },
    })

    const result = await tool.execute('read-3', { path: 'small.bmp' }, undefined, undefined, imageContext())

    expect(receivedMimeType).toBe('image/bmp')
    expect(Buffer.from(receivedBytes ?? [])).toEqual(bmp)
    expect(result.content.some(content => content.type === 'image')).toBe(true)
  })

  it('does not return an image block for a text-only model', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'selection-read-tool-'))
    tempDirs.push(cwd)
    writeFileSync(join(cwd, 'small.png'), png)
    const tool = createSelectionReadToolDefinition(cwd)

    const result = await tool.execute(
      'read-non-vision',
      { path: 'small.png' },
      undefined,
      undefined,
      { model: { input: ['text'] } } as never,
    )
    const text = result.content.find(content => content.type === 'text')

    expect(result.content.some(content => content.type === 'image')).toBe(false)
    const mismatch = text?.type === 'text' ? text.text : ''
    expect(mismatch).toContain('image_capability_mismatch')
    expect(mismatch).toContain('Do not OCR')
    expect(mismatch).toContain('leave G4 blocked')
  })

  it('uses the same pixel budget for a full original attachment and a crop', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'selection-read-tool-'))
    tempDirs.push(cwd)
    const id = '11111111-1111-4111-8111-111111111111'
    const attachments = join(cwd, 'attachments')
    mkdirSync(attachments)
    const original = join('attachments', `${id}_pasted-image-1.original.png`)
    const crop = join('attachments', 'crop.png')
    const wide = widePng(3200, 1800)
    writeFileSync(join(cwd, original), wide)
    writeFileSync(join(cwd, crop), wide)
    const seen: ImageResizeLimits[] = []
    const tool = createSelectionReadToolDefinition(cwd, undefined, {
      optimize: async (_bytes, _mimeType, limits) => {
        seen.push(limits)
        return {
          ok: true,
          bytes: png,
          mimeType: 'image/png',
          originalWidth: 3200,
          originalHeight: 1800,
          width: limits.maxWidth,
          height: 1,
          wasResized: true,
          encodingAttempts: 1,
          resizePasses: 1,
        }
      },
    })

    await tool.execute('read-original', { path: original }, undefined, undefined, imageContext())
    await tool.execute('read-crop', { path: crop }, undefined, undefined, imageContext())

    const policy = resolveImageSendPolicy()
    const target = resolveImageSendSize(3200, 1800, policy)
    expect(target).toEqual({ width: 2730, height: 1536 })
    const expected = {
      maxWidth: DEFAULT_MAX_WIDTH,
      maxHeight: DEFAULT_MAX_HEIGHT,
      maxEncodedBytes: DEFAULT_MAX_ENCODED_BYTES,
      jpegQuality: DEFAULT_JPEG_QUALITY,
      policy,
      applyDimensionBox: false,
      rejectOverEncodedLimit: false,
    }
    expect(seen).toEqual([expected, expected])
    expect(target.width).toBeGreaterThan(1568)
  })

  it('continues to delegate text files to the upstream read implementation', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'selection-read-tool-'))
    tempDirs.push(cwd)
    writeFileSync(join(cwd, 'notes.txt'), 'line one\nline two')
    const tool = createSelectionReadToolDefinition(cwd)

    const result = await tool.execute('read-4', { path: 'notes.txt', offset: 2 }, undefined, undefined, imageContext())
    const text = result.content.find(content => content.type === 'text')

    expect(text?.type === 'text' ? text.text : '').toBe('line two')
  })
})

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')

it('records only delivered lines with the original byte identity and concurrent invocation isolation', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-read-proof-'))
  tempDirs.push(cwd)
  writeFileSync(join(cwd, 'a.txt'), 'first\nsecond\nthird')
  writeFileSync(join(cwd, 'b.txt'), '\ufeffother\r\nnext')
  const tool = createSelectionReadToolDefinition(cwd)
  const [a, b] = await Promise.all([
    tool.execute('a', { path: 'a.txt', offset: 2, limit: 1 }, undefined, undefined, imageContext()),
    tool.execute('b', { path: 'b.txt' }, undefined, undefined, imageContext()),
  ])
  expect(a.details.sourceRead).toEqual({ path: realpathSync(join(cwd, 'a.txt')), contentHash: sha('first\nsecond\nthird'),
    startLine: 2, endLine: 2, returnedTextHash: sha('second') })
  expect(b.details.sourceRead).toEqual({ path: realpathSync(join(cwd, 'b.txt')), contentHash: sha('\ufeffother\r\nnext'),
    startLine: 1, endLine: 2, returnedTextHash: sha('\ufeffother\r\nnext') })
})

it('records the actual truncated prefix, never the unread rest of a long source', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-read-proof-'))
  tempDirs.push(cwd)
  const text = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`).join('\n')
  writeFileSync(join(cwd, 'long.txt'), text)
  const tool = createSelectionReadToolDefinition(cwd)
  const result = await tool.execute('long', { path: 'long.txt' }, undefined, undefined, imageContext())
  expect(result.details.sourceRead.endLine).toBe(2000)
  expect(result.details.sourceRead.returnedTextHash).toBe(sha(text.split('\n').slice(0, 2000).join('\n')))
  expect(result.content[0].text).toContain('Showing lines 1-2000')
})

it('does not certify image, binary, empty, invalid UTF-8 or an undelivered oversized first line', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-read-proof-'))
  tempDirs.push(cwd)
  const files = { 'image.png': png, 'binary.txt': Buffer.from([0, 65]), 'invalid.txt': Buffer.from([0xff]),
    'empty.txt': '', 'huge.txt': 'x'.repeat(60000) }
  const tool = createSelectionReadToolDefinition(cwd)
  for (const [path, bytes] of Object.entries(files)) {
    writeFileSync(join(cwd, path), bytes)
    const result = await tool.execute(path, { path }, undefined, undefined, imageContext())
    expect(result.details?.sourceRead).toBeUndefined()
  }
  expect(tool.execute('missing', { path: 'missing.txt' }, undefined, undefined, imageContext())).rejects.toThrow()
  expect(tool.execute('range', { path: 'binary.txt', offset: 9 }, undefined, undefined, imageContext())).rejects.toThrow()
})

it('preserves an actually returned EOF newline with the SDK content-line count', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-read-proof-'))
  tempDirs.push(cwd)
  const text = 'first\nsecond\n'
  writeFileSync(join(cwd, 'eof.txt'), text)
  const result = await createSelectionReadToolDefinition(cwd).execute('eof', { path: 'eof.txt' }, undefined, undefined, imageContext())
  expect(result.details.sourceRead).toMatchObject({ startLine: 1, endLine: 2, returnedTextHash: sha(text) })
  expect(result.content[0].text).toBe(text)
})
