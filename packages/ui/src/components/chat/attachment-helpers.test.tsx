import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileTypeIcon, getFileIconKind } from './attachment-helpers'

describe('file type icons (#407)', () => {
  test.each([
    ['计划.PPTX', 'powerpoint'], ['旧版.ppt', 'powerpoint'],
    ['报告.docx', 'word'], ['旧版.DOC', 'word'],
    ['数据.xlsx', 'excel'], ['旧版.xls', 'excel'], ['数据.csv', 'excel'],
    ['报告.pdf', 'pdf'], ['图片.png', 'image'], ['照片.HEIC', 'image'],
    ['说明.md', 'markdown'], ['说明.markdown', 'markdown'], ['页面.mdx', 'markdown'],
    ['说明.txt', 'text'], ['index.tsx', 'code'], ['backup.zip', 'archive'],
    ['录音.mp3', 'audio'], ['视频.mp4', 'video'], ['unknown.bin', 'file'],
    ['README', 'file'], ['/folder.pdf/README', 'file'], ['C:\\folder.docx\\README', 'file'],
  ] as const)('%s has a dedicated %s icon', (fileName, kind) => {
    expect(getFileIconKind({ fileName })).toBe(kind)
    expect(renderToStaticMarkup(<FileTypeIcon fileName={fileName} />)).toContain(`data-file-kind="${kind}"`)
  })

  test('specific filenames take precedence over generic MIME and attachment categories', () => {
    expect(getFileIconKind({ fileName: 'report.docx', mimeType: 'application/octet-stream', type: 'office' })).toBe('word')
    expect(getFileIconKind({ fileName: 'README.md', mimeType: 'text/plain', type: 'text' })).toBe('markdown')
    expect(getFileIconKind({ fileName: 'notes.txt', mimeType: 'application/pdf' })).toBe('text')
  })

  test.each([
    ['application/msword', 'word'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'excel'],
    ['application/vnd.ms-powerpoint', 'powerpoint'],
    ['APPLICATION/PDF; charset=utf-8', 'pdf'],
    ['text/markdown', 'markdown'], ['text/plain', 'text'], ['image/jpeg', 'image'],
  ] as const)('supports MIME-only attachments: %s', (mimeType, kind) => {
    expect(getFileIconKind({ mimeType })).toBe(kind)
  })

  test('document formats have distinct visible marks and preserve sizing', () => {
    for (const [fileName, mark] of [['a.docx', 'W'], ['a.xlsx', 'X'], ['a.pptx', 'P'], ['a.pdf', 'PDF'], ['a.md', 'MD'], ['a.txt', 'TXT']]) {
      const markup = renderToStaticMarkup(<FileTypeIcon fileName={fileName} className="h-5 w-5" />)
      expect(markup).toContain(`>${mark}</text>`)
      expect(markup).toContain('h-5 w-5')
      expect(markup).toContain('aria-hidden="true"')
    }
  })
})
