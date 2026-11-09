/**
 * Tests for @ mention file ranking / filtering.
 *
 * Ensures filesystem hits are scored and sorted so the matching file appears
 * at the top of the popup when the user types a path-like query.
 */

import { describe, it, expect, mock, beforeAll } from 'bun:test'

// mention-menu.tsx transitively imports pdfjs-dist via renderer component chain.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let scoreFileMatch: (name: string, relativePath: string, query: string) => number
let filterCacheResults: (
  cache: Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }>,
  query: string,
) => Array<{ type: string; label: string; description?: string }>
let defaultFileListing: (
  cache: Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }>,
  limit?: number,
) => Array<{ type: string; label: string }>
let filterSections: (
  sections: Array<{ id: string; label: string; items: Array<{
    id: string
    type: 'skill' | 'source' | 'file' | 'folder'
    label: string
    description?: string
    file?: { path: string; type: 'file' | 'directory'; relativePath: string }
  }> }>,
  filter: string,
) => Array<{ id: string; items: Array<{ type: string; label: string }> }>
let parseActiveMentionQuery: (
  textBeforeCursor: string
) => { atIndex: number; query: string } | null

beforeAll(async () => {
  const mod = await import('../mention-menu')
  scoreFileMatch = mod.scoreFileMatch
  filterCacheResults = mod.filterCacheResults
  defaultFileListing = mod.defaultFileListing
  filterSections = mod.filterSections
  parseActiveMentionQuery = mod.parseActiveMentionQuery
})

describe('scoreFileMatch', () => {
  it('ranks exact name highest', () => {
    expect(scoreFileMatch('App.tsx', 'src/App.tsx', 'app.tsx')).toBe(5)
  })

  it('ranks name prefix above path-only match', () => {
    const prefix = scoreFileMatch('AppShell.tsx', 'apps/electron/AppShell.tsx', 'app')
    const pathOnly = scoreFileMatch('index.ts', 'apps/electron/src/index.ts', 'app')
    expect(prefix).toBeGreaterThan(pathOnly)
  })

  it('returns 0 when nothing matches', () => {
    expect(scoreFileMatch('readme.md', 'docs/readme.md', 'zzz')).toBe(0)
  })
})

describe('filterCacheResults', () => {
  const cache = [
    { name: 'index.ts', path: '/w/index.ts', type: 'file' as const, relativePath: 'index.ts' },
    { name: 'App.tsx', path: '/w/src/App.tsx', type: 'file' as const, relativePath: 'src/App.tsx' },
    { name: 'AppShell.tsx', path: '/w/src/AppShell.tsx', type: 'file' as const, relativePath: 'src/AppShell.tsx' },
    { name: 'application.md', path: '/w/docs/application.md', type: 'file' as const, relativePath: 'docs/application.md' },
    { name: 'components', path: '/w/src/components', type: 'directory' as const, relativePath: 'src/components' },
  ]

  it('puts exact / prefix filename matches first', () => {
    const results = filterCacheResults(cache, 'App')
    expect(results[0]?.label).toBe('App.tsx')
    expect(results.map(r => r.label)).toContain('AppShell.tsx')
  })

  it('finds files via subsequence (appav → app availability style)', () => {
    const spaced = [
      { name: 'app availability.md', path: '/w/app availability.md', type: 'file' as const, relativePath: 'app availability.md' },
      { name: 'other.txt', path: '/w/other.txt', type: 'file' as const, relativePath: 'other.txt' },
    ]
    const results = filterCacheResults(spaced, 'appav')
    expect(results.some(r => r.label === 'app availability.md')).toBe(true)
  })

  it('returns alphabetical default listing for blank query (bare @ seed)', () => {
    const results = filterCacheResults(cache, '   ')
    expect(results.length).toBeGreaterThan(0)
    // Files before folders, then A–Z
    expect(results[0]?.type).toBe('file')
    const labels = results.map(r => r.label)
    // App.tsx should appear before application.md / AppShell among files
    expect(labels.indexOf('App.tsx')).toBeLessThan(labels.indexOf('AppShell.tsx'))
  })
})

describe('parseActiveMentionQuery', () => {
  it('parses ASCII queries', () => {
    expect(parseActiveMentionQuery('@hello')).toEqual({ atIndex: 0, query: 'hello' })
    expect(parseActiveMentionQuery('use @src/App.tsx')).toEqual({ atIndex: 4, query: 'src/App.tsx' })
  })

  it('parses Chinese / CJK queries (regression: ASCII \\w dropped the match)', () => {
    expect(parseActiveMentionQuery('@中文')).toEqual({ atIndex: 0, query: '中文' })
    expect(parseActiveMentionQuery('@文件.md')).toEqual({ atIndex: 0, query: '文件.md' })
    expect(parseActiveMentionQuery('请打开 @说明文档')).toEqual({ atIndex: 4, query: '说明文档' })
    expect(parseActiveMentionQuery('@src/中文/readme.md')).toEqual({ atIndex: 0, query: 'src/中文/readme.md' })
  })

  it('rejects email-style @', () => {
    expect(parseActiveMentionQuery('user@domain')).toBeNull()
  })
})

describe('filterSections', () => {
  // @ menu is files-only; skills live under `/`
  const sections = [
    {
      id: 'files',
      label: 'Files',
      items: [
        {
          id: '/w/src/App.tsx',
          type: 'file' as const,
          label: 'App.tsx',
          description: 'src/App.tsx',
          file: { path: '/w/src/App.tsx', type: 'file' as const, relativePath: 'src/App.tsx' },
        },
        {
          id: '/w/docs/说明文档.md',
          type: 'file' as const,
          label: '说明文档.md',
          description: 'docs/说明文档.md',
          file: { path: '/w/docs/说明文档.md', type: 'file' as const, relativePath: 'docs/说明文档.md' },
        },
        {
          id: '/w/apps/electron',
          type: 'folder' as const,
          label: 'electron',
          description: 'apps/electron',
          file: { path: '/w/apps/electron', type: 'directory' as const, relativePath: 'apps/electron' },
        },
      ],
    },
  ]

  it('returns matching files for the query', () => {
    const filtered = filterSections(sections, 'app')
    expect(filtered).toHaveLength(1)
    const items = filtered[0]!.items
    expect(items[0]?.type).toBe('file')
    expect(items[0]?.label).toBe('App.tsx')
    expect(items.every(i => i.type === 'file' || i.type === 'folder')).toBe(true)
  })

  it('matches Chinese filenames', () => {
    const filtered = filterSections(sections, '说明')
    expect(filtered).toHaveLength(1)
    const items = filtered[0]!.items
    expect(items[0]?.type).toBe('file')
    expect(items[0]?.label).toBe('说明文档.md')
  })

  it('puts Files section first when filter is empty', () => {
    const ordered = filterSections(sections, '')
    expect(ordered[0]?.id).toBe('files')
  })

  it('returns empty when nothing matches', () => {
    expect(filterSections(sections, 'zzzz-no-match')).toEqual([])
  })
})

describe('defaultFileListing', () => {
  it('sorts files before folders and alphabetically by name', () => {
    const cache = [
      { name: 'zebra.md', path: '/w/zebra.md', type: 'file' as const, relativePath: 'zebra.md' },
      { name: 'src', path: '/w/src', type: 'directory' as const, relativePath: 'src' },
      { name: 'alpha.ts', path: '/w/alpha.ts', type: 'file' as const, relativePath: 'alpha.ts' },
      { name: 'docs', path: '/w/docs', type: 'directory' as const, relativePath: 'docs' },
    ]
    const listing = defaultFileListing(cache, 10)
    expect(listing.map(i => i.label)).toEqual(['alpha.ts', 'zebra.md', 'docs', 'src'])
  })

  it('respects the limit', () => {
    const cache = Array.from({ length: 30 }, (_, i) => ({
      name: `f${String(i).padStart(2, '0')}.txt`,
      path: `/w/f${String(i).padStart(2, '0')}.txt`,
      type: 'file' as const,
      relativePath: `f${String(i).padStart(2, '0')}.txt`,
    }))
    expect(defaultFileListing(cache, 8)).toHaveLength(8)
  })
})

describe('Chinese file scoring', () => {
  it('scores Chinese name contains / prefix / exact', () => {
    expect(scoreFileMatch('说明文档.md', 'docs/说明文档.md', '说明文档.md')).toBe(5)
    expect(scoreFileMatch('说明文档.md', 'docs/说明文档.md', '说明')).toBe(4)
    expect(scoreFileMatch('项目说明.md', 'docs/项目说明.md', '说明')).toBe(3)
    expect(scoreFileMatch('readme.md', 'docs/说明/readme.md', '说明')).toBe(2)
  })

  it('filters Chinese names from cache', () => {
    const cache = [
      { name: '说明文档.md', path: '/w/docs/说明文档.md', type: 'file' as const, relativePath: 'docs/说明文档.md' },
      { name: 'readme.md', path: '/w/readme.md', type: 'file' as const, relativePath: 'readme.md' },
    ]
    const results = filterCacheResults(cache, '说明')
    expect(results).toHaveLength(1)
    expect(results[0]?.label).toBe('说明文档.md')
  })
})
