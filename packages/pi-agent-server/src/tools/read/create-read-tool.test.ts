import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
