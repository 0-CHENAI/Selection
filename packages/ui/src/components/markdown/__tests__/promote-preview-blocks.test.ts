import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { preprocessLinks } from '../linkify'
import { promoteBarePreviewBlocks } from '../promote-preview-blocks'

describe('promoteBarePreviewBlocks', () => {
  it('wraps a bare image-preview spec from a final answer (#358)', () => {
    const input = [
      '交付完成。',
      '',
      'image-preview',
      '{',
      '  "src": "/Users/chenai/.selection/workspaces/my-workspace/sessions/260915-onyx-basalt/downloads/browser-screenshot-1.jpg",',
      '  "title": "订单履约与异步事件架构 · 整体预览"',
      '}',
      '',
      '## 已满足的关键约束',
    ].join('\n')

    const promoted = promoteBarePreviewBlocks(input)
    expect(promoted).toContain('```image-preview\n{')
    expect(promoted).toContain('browser-screenshot-1.jpg')
    expect(promoted).toContain('```\n\n## 已满足的关键约束')
    expect(preprocessLinks(promoted)).toContain('```image-preview')
    expect(preprocessLinks(promoted)).not.toContain('](/Users/chenai/.selection')
  })

  it('leaves an already-fenced image-preview block unchanged', () => {
    const input = [
      '```image-preview',
      '{',
      '  "src": "/tmp/shot.jpg",',
      '  "title": "Shot"',
      '}',
      '```',
    ].join('\n')

    expect(promoteBarePreviewBlocks(input)).toBe(input)
  })

  it('does not promote a preview name inside a generic fence', () => {
    const input = [
      '```',
      'image-preview',
      '{',
      '  "src": "/tmp/shot.jpg"',
      '}',
      '```',
    ].join('\n')

    expect(promoteBarePreviewBlocks(input)).toBe(input)
  })

  it('is wired into the chat markdown preprocessor', () => {
    const markdown = readFileSync(join(import.meta.dir, '../Markdown.tsx'), 'utf8')
    expect(markdown).toContain('promoteBarePreviewBlocks')
  })
})
