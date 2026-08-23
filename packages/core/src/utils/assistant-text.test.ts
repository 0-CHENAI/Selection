import { describe, expect, it } from 'bun:test'
import { hasRenderableAssistantText, preferRicherAssistantText } from './assistant-text.ts'

describe('preferRicherAssistantText (#81)', () => {
  it('keeps a renderable complete over a longer unrelated stream', () => {
    expect(preferRicherAssistantText('改好了。', '先读 skill 文件再继续检查文档。')).toBe('改好了。')
  })

  it('recovers a truncated complete from the streamed body', () => {
    expect(preferRicherAssistantText('|', '| name | value |\n| --- | --- |')).toBe(
      '| name | value |\n| --- | --- |',
    )
    expect(preferRicherAssistantText('先读', '先读 skill 文件再继续检查文档。')).toBe(
      '先读 skill 文件再继续检查文档。',
    )
  })

  it('falls back when complete is a pipe-only stub', () => {
    expect(preferRicherAssistantText('|', '先读 skill 文件再继续检查文档。', '')).toBe(
      '先读 skill 文件再继续检查文档。',
    )
  })

  it('falls back to empty string when nothing is present', () => {
    expect(preferRicherAssistantText(undefined, null, '')).toBe('')
  })
})

describe('hasRenderableAssistantText (#81)', () => {
  it('rejects empty, whitespace, and pipe-only stubs', () => {
    expect(hasRenderableAssistantText('')).toBe(false)
    expect(hasRenderableAssistantText('   ')).toBe(false)
    expect(hasRenderableAssistantText('|')).toBe(false)
    expect(hasRenderableAssistantText(' | | ')).toBe(false)
  })

  it('accepts real commentary, tables, and Read line-number dumps', () => {
    expect(hasRenderableAssistantText('先读 skill 文件。')).toBe(true)
    expect(hasRenderableAssistantText('| name | value |\n| --- | --- |\n| a | 1 |')).toBe(true)
    expect(hasRenderableAssistantText('     1|---\n     2|name: officecli')).toBe(true)
  })
})
