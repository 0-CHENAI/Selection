import { describe, it, expect } from 'bun:test'
import { markdownToPlainText } from '../markdown-to-plain-text.ts'

describe('markdownToPlainText', () => {
  it('strips bold and headers while keeping text', () => {
    expect(markdownToPlainText('## Hello **world**')).toBe('Hello world')
  })

  it('preserves code content without fences', () => {
    const md = 'Use:\n```ts\nconst x = 1\n```\ndone'
    const plain = markdownToPlainText(md)
    expect(plain).toContain('const x = 1')
    expect(plain).not.toContain('```')
    expect(plain).toContain('Use:')
    expect(plain).toContain('done')
  })

  it('converts links to labels', () => {
    expect(markdownToPlainText('See [docs](https://example.com)')).toBe('See docs')
  })

  it('keeps list structure as plain bullets', () => {
    const md = '- one\n- two'
    expect(markdownToPlainText(md)).toBe('• one\n• two')
  })

  it('returns empty for empty input', () => {
    expect(markdownToPlainText('')).toBe('')
  })
})
