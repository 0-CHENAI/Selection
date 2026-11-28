import * as React from 'react'
import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import zhHans from '../../../../../shared/src/i18n/locales/zh-Hans.json'
import { TooltipProvider } from '../../tooltip'
import { extractDeliveredResponseArtifacts, organizeArtifactShelf, type ResponseArtifact } from '../response-artifacts'
import type { MergedArtifactRow } from '../artifact-supplements'
import { ResponseArtifacts } from '../ResponseArtifacts'

it('shows every supported changed file without a link or a model selection', () => {
  const names = ['a.doc', 'b.DOCX', 'b.docm', 'b.dotx', 'b.rtf', 'c.ppt', 'd.PPTX', 'd.pptm', 'd.potx', 'd.ppsx',
    'e.xls', 'f.XLSX', 'f.xlsm', 'f.xlsb', 'f.xltx', 'g.htm', 'h.HTML', 'j.tex', 'j.latex', 'k.md', 'l.markdown', 'm.pdf']
  const versions = names.map(name => ({ path: `/results/${name}`, change: 'created' as const }))
  expect(extractDeliveredResponseArtifacts(versions).map(file => file.name)).toEqual(names)
})

it('excludes unsupported formats, deleted files and session scratch', () => {
  const versions = [
    { path: '/results/report.pdf', change: 'modified' as const },
    { path: '/results/chart.png', change: 'created' as const },
    { path: '/results/raw.csv', change: 'created' as const },
    { path: '/results/raw.json', change: 'created' as const },
    { path: '/results/old.docx', change: 'deleted' as const },
    { path: '{{SESSION_PATH}}/data/draft.md', change: 'created' as const },
    { path: '{{SESSION_PATH}}/long_responses/read.txt', change: 'created' as const },
    { path: '/work/sessions/current/long_responses/tool.txt', change: 'created' as const },
    { path: 'C:\\work\\sessions\\current\\long_responses\\tool.txt', change: 'created' as const },
  ]
  expect(extractDeliveredResponseArtifacts(versions)).toEqual([
    { path: '/results/report.pdf', name: 'report.pdf', extension: 'pdf', change: 'modified' },
  ])
  expect(extractDeliveredResponseArtifacts()).toEqual([])
})

it('hides historical source-cache and TXT cards on every platform while keeping other documents', () => {
  const paths = [
    '/work/.selection-sources/version/snapshot.txt',
    '.selection-sources/version/snapshot.txt',
    'C:\\work\\.selection-sources\\version\\snapshot.txt',
    '/work/.selection-sources/version/extracted.md',
    '/results/snapshot.txt',
    '/work/.selection-sources-export/snapshot.txt',
    'C:\\results\\REPORT.TXT',
    '/results/report.pdf',
    '/work/.selection-sources-export/report.md',
  ]
  expect(extractDeliveredResponseArtifacts(paths.map(path => ({ path, ordinal: 1 }))).map(file => file.path))
    .toEqual(paths.slice(7))
})

it('shows a session-root pptx and a working-directory pptx, and skips the scratch export', () => {
  expect(extractDeliveredResponseArtifacts([
    { path: '/work/sessions/current/data/deck.pptx', change: 'created' },
    { path: '/work/sessions/current/季度经营会.pptx', change: 'created' },
    { path: '/projects/brief/季度经营会.pptx', change: 'created' },
  ]).map(file => file.path)).toEqual([
    '/work/sessions/current/季度经营会.pptx',
    '/projects/brief/季度经营会.pptx',
  ])
})

it('keeps distinct paths, deduplicates aliases and preserves restored versions', () => {
  expect(extractDeliveredResponseArtifacts([
    { path: 'C:/Reports/Final.DOCX', change: 'restored' },
    { path: 'c:\\reports\\final.docx', change: 'modified' },
    { path: 'D:/Reports/Final.DOCX', ordinal: 1 },
  ])).toEqual([
    { path: 'C:/Reports/Final.DOCX', name: 'Final.DOCX', extension: 'docx', change: 'restored' },
    { path: 'D:/Reports/Final.DOCX', name: 'Final.DOCX', extension: 'docx', change: 'created' },
  ])
})

function makeRow(path: string, supplement?: MergedArtifactRow['supplement']): MergedArtifactRow {
  const name = path.replace(/\\/g, '/').split('/').pop()!
  const artifact: ResponseArtifact = {
    path,
    name,
    extension: name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
    change: 'created',
  }
  return { artifact, ...(supplement ? { supplement } : {}), synthetic: false }
}

it('prioritizes linked deliverables and clusters large subdirectory batches into folder cards', () => {
  const rows: MergedArtifactRow[] = [
    ...Array.from({ length: 12 }, (_, i) => makeRow(`/work/proj/chapters/ch-${String(i + 1).padStart(2, '0')}.md`)),
    ...Array.from({ length: 6 }, (_, i) => makeRow(`/work/proj/charts/chart-${i + 1}.html`)),
    makeRow('/work/proj/最终分析报告.docx'),
    makeRow('/work/proj/执行摘要.pdf'),
  ]
  const organized = organizeArtifactShelf(rows, {
    responseText: '分析已完成，核心交付见 [最终分析报告](最终分析报告.docx) 与 `执行摘要.pdf`。',
  })

  expect(organized.orderedRows[0]?.artifact.name).toBe('最终分析报告.docx')
  expect(organized.orderedRows[1]?.artifact.name).toBe('执行摘要.pdf')
  expect(organized.hasGroups).toBe(true)
  expect(organized.shelfItems.map(item => item.kind === 'item' ? item.row.artifact.name : `${item.label}(${item.rows.length})`))
    .toEqual(['最终分析报告.docx', '执行摘要.pdf', 'charts/(6)', 'chapters/(12)'])
  expect(organized.categories).toEqual([
    { category: 'document', count: 1 },
    { category: 'pdf', count: 1 },
    { category: 'html', count: 6 },
    { category: 'markdown', count: 12 },
  ])
})

it('surfaces top deliverables and clusters remaining files when many outputs live flat in one folder', () => {
  const rows: MergedArtifactRow[] = [
    ...Array.from({ length: 30 }, (_, i) => makeRow(`/work/outputs/note-${i + 1}.md`)),
    makeRow('/work/outputs/季度汇总.docx'),
    makeRow('/work/outputs/预算表.xlsx'),
  ]
  const organized = organizeArtifactShelf(rows)
  expect(organized.hasGroups).toBe(true)
  expect(organized.shelfItems[0]?.kind).toBe('item')
  expect(organized.shelfItems[0]?.kind === 'item' && organized.shelfItems[0].row.artifact.name).toBe('季度汇总.docx')
  expect(organized.shelfItems[1]?.kind).toBe('item')
  expect(organized.shelfItems[1]?.kind === 'item' && organized.shelfItems[1].row.artifact.name).toBe('预算表.xlsx')
  expect(organized.shelfItems[2]?.kind).toBe('group')
  if (organized.shelfItems[2]?.kind === 'group') {
    expect(organized.shelfItems[2].label).toBe('outputs/')
    expect(organized.shelfItems[2].revealPath).toBe('/work/outputs')
    expect(organized.shelfItems[2].rows).toHaveLength(30)
    expect(organized.shelfItems[2].extensions).toEqual(['MD'])
  }
})

it('mounts at most 4 shelf items in collapsed DOM even when 100 deliverables are passed', async () => {
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: zhHans } } })

  const artifacts: ResponseArtifact[] = [
    ...Array.from({ length: 60 }, (_, i) => ({
      path: `/work/proj/chapters/ch-${i + 1}.md`,
      name: `ch-${i + 1}.md`,
      extension: 'md',
      change: 'created' as const,
    })),
    ...Array.from({ length: 38 }, (_, i) => ({
      path: `/work/proj/pages/page-${i + 1}.html`,
      name: `page-${i + 1}.html`,
      extension: 'html',
      change: 'created' as const,
    })),
    { path: '/work/proj/总报告.docx', name: '总报告.docx', extension: 'docx', change: 'created' },
    { path: '/work/proj/演示文稿.pptx', name: '演示文稿.pptx', extension: 'pptx', change: 'created' },
  ]

  const html = renderToStaticMarkup(
    React.createElement(
      I18nextProvider,
      { i18n },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ResponseArtifacts, {
          artifacts,
          responseText: '核心交付：[总报告](总报告.docx) 和 [演示文稿](演示文稿.pptx)。',
        }),
      ),
    ),
  )

  const listItems = html.match(/<li\b/g) ?? []
  expect(listItems.length).toBeLessThanOrEqual(4)
  expect(html).toContain('总报告.docx')
  expect(html).toContain('演示文稿.pptx')
  expect(html).toContain('data-testid="artifact-folder-group"')
  expect(html).toContain('查看所有成果（100）')
  expect(html).not.toContain('ch-50.md')
})

it('handles Windows mixed-case folder grouping, deep folder label elision, CJK mentions and entry-point suffixes', () => {
  const winRows: MergedArtifactRow[] = [
    ...Array.from({ length: 5 }, (_, i) => makeRow(
      i % 2 === 0
        ? `C:\\Work\\Proj\\deep\\nested\\chapters\\ch-${i + 1}.md`
        : `c:/work/proj/deep/nested/chapters/ch-${i + 1}.md`,
    )),
    makeRow('C:\\Work\\Proj\\2026年度汇总.md'),
    makeRow('C:\\Work\\Proj\\a.doc'),
    makeRow('C:\\Work\\Proj\\a.docx'),
    makeRow('C:\\Work\\Proj\\最终报告.md'),
  ]
  const organized = organizeArtifactShelf(winRows, {
    responseText: '已生成最终报告.md并保存，另外补充了 **a.docx**。',
  })

  // Both adjacent-CJK mention (最终报告.md) and bold ASCII mention (**a.docx**) rank above unmentioned a.doc & chapters.
  expect(organized.orderedRows[0]?.artifact.name).toBe('a.docx')
  expect(organized.orderedRows[1]?.artifact.name).toBe('最终报告.md')
  // Chinese entry-point suffix (2026年度汇总.md) ranks ahead of chapter files.
  expect(organized.orderedRows.findIndex(r => r.artifact.name === '2026年度汇总.md'))
    .toBeLessThan(organized.orderedRows.findIndex(r => r.artifact.name === 'ch-1.md'))
  // a.doc must NOT be treated as mentioned just because "a.docx" appears in responseText.
  expect(organized.orderedRows.findIndex(r => r.artifact.name === 'a.docx'))
    .toBeLessThan(organized.orderedRows.findIndex(r => r.artifact.name === 'a.doc'))

  // Mixed-case Windows paths share one folder group with elided >2 segment label and directory revealPath.
  const group = organized.shelfItems.find(item => item.kind === 'group')
  expect(group?.kind).toBe('group')
  if (group?.kind === 'group') {
    expect(group.rows).toHaveLength(5)
    expect(group.label).toBe('…/nested/chapters/')
    expect(group.revealPath).toBe('C:/Work/Proj/deep/nested/chapters')
  }

  // Drive-root files preserve trailing slash on revealPath.
  const driveRootGroup = organizeArtifactShelf(
    Array.from({ length: 6 }, (_, i) => makeRow(`C:\\note-${i + 1}.md`)),
  ).shelfItems.find(item => item.kind === 'group')
  expect(driveRootGroup?.kind).toBe('group')
  if (driveRootGroup?.kind === 'group') {
    expect(driveRootGroup.label).toBe('C:/')
    expect(driveRootGroup.revealPath).toBe('C:/')
  }
})
