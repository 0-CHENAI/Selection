import { describe, expect, it } from 'bun:test'
import { mergeSummarizedToolResult } from './tool-result-images.ts'

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
