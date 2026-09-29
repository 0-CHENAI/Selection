import { expect, it } from 'bun:test'
import { extractDeliveredResponseArtifacts } from '../response-artifacts'

it('shows every supported changed file without a link or a model selection', () => {
  const names = ['a.doc', 'b.DOCX', 'b.docm', 'b.dotx', 'b.rtf', 'c.ppt', 'd.PPTX', 'd.pptm', 'd.potx', 'd.ppsx',
    'e.xls', 'f.XLSX', 'f.xlsm', 'f.xlsb', 'f.xltx', 'g.htm', 'h.HTML', 'i.txt', 'j.tex', 'j.latex', 'k.md', 'l.markdown', 'm.pdf']
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
  ]
  expect(extractDeliveredResponseArtifacts(versions)).toEqual([
    { path: '/results/report.pdf', name: 'report.pdf', extension: 'pdf', change: 'modified' },
  ])
  expect(extractDeliveredResponseArtifacts()).toEqual([])
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
