import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageOptimizationResult } from './image-resize-types.ts'
import { createSelectionReadToolDefinition } from './create-read-tool.ts'

const tempDirs: string[] = []
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
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
    expect(text?.type === 'text' ? text.text : '').toContain('image_capability_mismatch')
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
