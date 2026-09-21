import { describe, expect, it } from 'bun:test'
import { extractResponseArtifacts } from '../response-artifacts'

describe('final response artifacts', () => {
  it('collects delivered documents, images and reference links in response order', () => {
    const files = extractResponseArtifacts('[报告](/成果/报告.docx)\n![图表](/成果/chart.png)\n[表格][sheet]\n\n[sheet]: /成果/data.xlsx')
    expect(files.map(file => file.name)).toEqual(['报告.docx', 'chart.png', 'data.xlsx'])
  })

  it('uses actual filenames and decodes spaces; keeps separate files with the same basename', () => {
    expect(extractResponseArtifacts('[下载](/a/Report%20Final.PDF) [报告](/b/Report%20Final.PDF)').map(file => file.path))
      .toEqual(['/a/Report Final.PDF', '/b/Report Final.PDF'])
  })

  it('deduplicates Windows file URLs and paths without changing the open target', () => {
    const files = extractResponseArtifacts('[报告](file:///C:/Reports/Final.docx)\n[重复](C:/reports/final.docx)')
    expect(files).toEqual([{ path: 'C:/Reports/Final.docx', name: 'Final.docx', extension: 'docx' }])
  })

  it('collects preview specs and deduplicates links to the same delivered file', () => {
    const text = '[报告](/report.md)\n```markdown-preview\n{"src":"/report.md"}\n```\n```html-preview\n{"items":[{"src":"/page.html"},{"src":"/other.html"}]}\n```'
    expect(extractResponseArtifacts(text).map(file => file.path)).toEqual(['/report.md', '/page.html', '/other.html'])
  })

  it('supports bare preview blocks and relative file destinations', () => {
    expect(extractResponseArtifacts('pdf-preview\n{"src":"./report.pdf"}').map(file => file.path)).toEqual(['./report.pdf'])
    expect(extractResponseArtifacts('[下载](report.pdf)').map(file => file.path)).toEqual(['report.pdf'])
  })

  it('does not turn URLs, source code, sample code, plain paths or unused references into deliverables', () => {
    const text = '[网页](https://example.com/report.pdf) [网站](https://report.md) [代码](/src/main.ts)\n`/tmp/file.docx`\n/tmp/raw.pdf\n```text\n[示例](/tmp/sample.docx)\n```\n[unused]: /tmp/unused.pdf'
    expect(extractResponseArtifacts(text)).toEqual([])
  })

  it('ignores unsafe protocols and malformed preview specs', () => {
    expect(extractResponseArtifacts('[运行](javascript:alert.pdf) [内容](data:image/png;base64,abc)\n```html-preview\n{"items":[null,{"src":42}]}\n```')).toEqual([])
  })
})

describe('artifact extraction review regressions', () => {
  it('uses the first reference definition just like the rendered Markdown link', () => {
    expect(extractResponseArtifacts('[报告][file]\n\n[file]: /first.docx\n[file]: /wrong.docx').map(file => file.path)).toEqual(['/first.docx'])
  })

  it('recognizes explicitly linked relative Office formats outside the generic preview allowlist', () => {
    expect(extractResponseArtifacts('[文档](report.docm) [表格](data.ods) [幻灯片](deck.pptm)').map(file => file.name)).toEqual(['report.docm', 'data.ods', 'deck.pptm'])
  })

  it('does not misclassify whitespace-prefixed remote preview URLs as local files', () => {
    expect(extractResponseArtifacts('```markdown-preview\n{"src":"  https://report.md"}\n```')).toEqual([])
  })

  it('rejects encoded control characters and keeps path identity separate from the label', () => {
    expect(extractResponseArtifacts('[fake.pdf](/real.docx) [bad](/bad%00.pdf) [encoded](javascript%3Aevil.pdf)')).toEqual([{ path: '/real.docx', name: 'real.docx', extension: 'docx' }])
  })
})


it('does not list a linked cover thumbnail as a second deliverable', () => {
  expect(extractResponseArtifacts('[![封面](/tmp/cover.png)](/report.docx)').map(file => file.path)).toEqual(['/report.docx'])
})
