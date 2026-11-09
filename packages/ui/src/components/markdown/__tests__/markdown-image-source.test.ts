import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveMarkdownImageSource } from '../markdown-image-source'

describe('resolveMarkdownImageSource (#358)', () => {
  it('keeps remote https images', () => {
    expect(resolveMarkdownImageSource('https://example.com/shot.png')).toEqual({
      kind: 'remote',
      src: 'https://example.com/shot.png',
    })
  })

  it('keeps data-image URLs that Chromium can render', () => {
    expect(resolveMarkdownImageSource('data:image/png;base64,aaa')).toEqual({
      kind: 'data',
      src: 'data:image/png;base64,aaa',
    })
  })

  it('routes local unix, windows, and file: paths through the file loader', () => {
    expect(resolveMarkdownImageSource('/Users/tester/shot.png')).toEqual({
      kind: 'file',
      path: '/Users/tester/shot.png',
    })
    expect(resolveMarkdownImageSource('C:\\Users\\tester\\shot.png')).toEqual({
      kind: 'file',
      path: 'C:\\Users\\tester\\shot.png',
    })
    expect(resolveMarkdownImageSource('file:///C:/Users/tester/shot.png')).toEqual({
      kind: 'file',
      path: 'C:/Users/tester/shot.png',
    })
  })

  it('blocks javascript and empty sources so they never become <img src>', () => {
    expect(resolveMarkdownImageSource('javascript:alert(1)')).toEqual({ kind: 'blocked' })
    expect(resolveMarkdownImageSource('')).toEqual({ kind: 'blocked' })
    expect(resolveMarkdownImageSource(undefined)).toEqual({ kind: 'blocked' })
  })

  it('wires the chat markdown renderer to MarkdownImage', () => {
    const markdown = readFileSync(join(import.meta.dir, '../Markdown.tsx'), 'utf8')
    expect(markdown).toContain('MarkdownImage')
    expect(markdown).toContain('img:')
  })
})
