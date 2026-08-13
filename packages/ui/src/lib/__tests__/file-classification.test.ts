import { describe, expect, it } from 'bun:test'
import { classifyFile, FILE_EXTENSIONS_PATTERN } from '../file-classification'

describe('classifyFile', () => {
  it('renders HTML files as a webpage preview, not source', () => {
    expect(classifyFile('D:\\selection\\巡察工作\\report.html')).toEqual({
      type: 'html',
      canPreview: true,
    })
    expect(classifyFile('index.htm')).toEqual({ type: 'html', canPreview: true })
    expect(classifyFile('docs/page.xhtml')).toEqual({ type: 'html', canPreview: true })
  })

  it('still treats XML as code and SVG as an image', () => {
    expect(classifyFile('data.xml')).toEqual({ type: 'code', canPreview: true })
    expect(classifyFile('logo.svg')).toEqual({ type: 'image', canPreview: true })
  })

  it('still treats other code files as code', () => {
    expect(classifyFile('app.ts')).toEqual({ type: 'code', canPreview: true })
    expect(classifyFile('styles.css')).toEqual({ type: 'code', canPreview: true })
  })

  it('still detects .html paths for markdown autolinking', () => {
    expect(new RegExp(`\\.(?:${FILE_EXTENSIONS_PATTERN})$`, 'i').test('report.html')).toBe(true)
  })
})
