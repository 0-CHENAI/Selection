import { describe, expect, it } from 'bun:test'
import { extractChangedResponseArtifacts, extractResponseArtifacts, extractUnversionedResponseArtifacts } from '../response-artifacts'

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
    expect(extractUnversionedResponseArtifacts(String.raw`[报告](file:///C:\Users\me\Desktop\Final.docx)`))
      .toEqual([{ path: 'C:/Users/me/Desktop/Final.docx', name: 'Final.docx', extension: 'docx' }])
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

it('shows only newly created or changed files on the delivery shelf', () => {
  const answer = '[新版](/reports/new.docx) [原版](/reports/original.docx)'
  expect(extractChangedResponseArtifacts(answer, [{ path: '/reports/new.docx', ordinal: 1, change: 'created' }]).map(file => file.name))
    .toEqual(['new.docx'])
  expect(extractChangedResponseArtifacts(answer, [])).toEqual([])
  expect(extractChangedResponseArtifacts(answer)).toEqual([])
})

it('keeps the linked result shelf for answers saved before version metadata existed', () => {
  const answer = '[报告](report.docx) [草稿]({{SESSION_PATH}}/data/draft.docx)'
  expect(extractUnversionedResponseArtifacts(answer)).toEqual([
    { path: 'report.docx', name: 'report.docx', extension: 'docx' },
  ])
  expect(extractChangedResponseArtifacts(answer, [])).toEqual([])
})

it('shows a deletion even when the answer does not link the file, and keeps a citation off the shelf', () => {
  expect(extractChangedResponseArtifacts('旧稿已删除。', [{ path: '/reports/old.docx', ordinal: 2, change: 'deleted' }]))
    .toEqual([{ path: '/reports/old.docx', name: 'old.docx', extension: 'docx', change: 'deleted' }])
  expect(extractChangedResponseArtifacts('[上一份报告](/reports/old.docx)')).toEqual([])
})

it('shows a restored version even when the answer does not repeat its file link', () => {
  expect(extractChangedResponseArtifacts('已恢复第 1 版。', [
    { path: 'C:/Reports/report.docx', ordinal: 3, change: 'restored' },
  ])).toEqual([{ path: 'C:/Reports/report.docx', name: 'report.docx', extension: 'docx', change: 'restored' }])
})

it('keeps helper scripts and other session scratch off the result shelf', () => {
  const answer = '[领导版](/reports/领导版.docx)（原文件 [原版](/reports/原版.docx) 未做任何修改）'
  const shown = extractChangedResponseArtifacts(answer, [
    { path: '{{SESSION_PATH}}/data/build_content.py', ordinal: 2, change: 'modified' },
    { path: '/Users/me/.selection/workspaces/my-workspace/sessions/260928-young-geyser/data/notes.json', ordinal: 1, change: 'created' },
    { path: '/reports/领导版.docx', ordinal: 1, change: 'created' },
    { path: '/reports/原版.docx', ordinal: 1, change: 'created' },
  ])
  expect(shown.map(file => file.name)).toEqual(['领导版.docx', '原版.docx'])
  expect(extractChangedResponseArtifacts('草稿已删除。', [{ path: '{{SESSION_PATH}}/data/draft.docx', ordinal: 1, change: 'deleted' }])).toEqual([])
})

it('matches version references without confusing equal filenames in different directories', () => {
  const answer = '[新版](./new.docx) [同名旧版](/archive/new.docx)'
  expect(extractChangedResponseArtifacts(answer, [{ path: 'new.docx', ordinal: 2, change: 'modified' }]).map(file => file.path))
    .toEqual(['./new.docx'])
})
