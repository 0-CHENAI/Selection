import { describe, expect, it } from 'bun:test'
import { fitToolResultImages, mergeSummarizedToolResult } from './tool-result-images.ts'

const pixel = {
  type: 'image',
  mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ANcyFP8FHgIdBOVbKQAAAABJRU5ErkJggg==',
}

describe('fitToolResultImages', () => {
  it('preserves all image blocks in order if an individual image cannot be optimized', async () => {
    const unableToOptimize = { type: 'image', mimeType: 'image/png', data: 'abc' }
    const parts = [{ type: 'text', text: 'Page 1' }, pixel, { type: 'text', text: 'Page 2' }, unableToOptimize]
    expect(await fitToolResultImages(parts, undefined, { preferInProcess: true })).toEqual({ content: parts, blockedImages: 0 })
  })

  it('keeps a deliverable Office image and reports any page whose original exceeds a hard model cap', async () => {
    const pagePath = { type: 'text', text: 'Page 2 saved at /session/office-render/doc-2.png' }
    const unusable = { ...pixel, data: Buffer.alloc(2048).toString('base64') }
    const result = await fitToolResultImages([pixel, pagePath, unusable], { maxEncodedBytes: 1024 }, {
      enforceModelLimits: true,
      preferInProcess: true,
    })
    expect(result).toEqual({
      blockedImages: 1,
      content: [pixel, pagePath, { type: 'text', text: expect.stringContaining('Visual inspection is incomplete') }],
    })
  })

  it('retains a text-only bridge outcome after cancellation', async () => {
    const content = [{ type: 'text', text: 'Tool wait interrupted. Operation outcome unknown; verify before retrying.' }]
    const signal = AbortSignal.abort()
    expect(await fitToolResultImages(content, undefined, { signal })).toEqual({ content, blockedImages: 0 })
  })

  it('honors turn cancellation before returning a tool result', async () => {
    const reason = new Error('turn stopped')
    await expect(fitToolResultImages([pixel], undefined, {
      signal: AbortSignal.abort(reason),
    })).rejects.toBe(reason)
  })
})

describe('mergeSummarizedToolResult', () => {
  it('keeps image blocks when a large text result is summarized', () => {
    const summarized = mergeSummarizedToolResult('summary of a huge office preview', [
      { type: 'text', text: 'x'.repeat(20_000) },
      { type: 'image', data: 'abc', mimeType: 'image/png' },
    ])

    expect(summarized).toEqual([
      { type: 'text', text: 'summary of a huge office preview' },
      { type: 'image', data: 'abc', mimeType: 'image/png' },
    ])
  })

  it('returns only the summary when the original result had no images', () => {
    expect(mergeSummarizedToolResult('summary', [{ type: 'text', text: 'huge' }])).toEqual([
      { type: 'text', text: 'summary' },
    ])
  })
})
