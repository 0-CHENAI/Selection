import { describe, it, expect } from 'bun:test'
import {
  parseMarkdownPreviewSpec,
  normalizePreviewItems,
  isHtmlPreviewCoveredByArtifacts,
} from '../markdown-preview-helpers'

describe('parseMarkdownPreviewSpec', () => {
  it('parses a valid single-item spec with src and title', () => {
    const code = JSON.stringify({ src: '/tmp/file.md', title: 'My Title' })
    expect(parseMarkdownPreviewSpec(code)).toEqual({
      src: '/tmp/file.md',
      title: 'My Title',
    })
  })

  it('parses a valid single-item spec without a title', () => {
    const code = JSON.stringify({ src: '/tmp/file.md' })
    expect(parseMarkdownPreviewSpec(code)).toEqual({
      src: '/tmp/file.md',
      title: undefined,
    })
  })

  it('parses a valid multi-item spec', () => {
    const code = JSON.stringify({
      title: 'Versions',
      items: [
        { src: '/tmp/a.md', label: 'A' },
        { src: '/tmp/b.md' },
      ],
    })
    expect(parseMarkdownPreviewSpec(code)).toEqual({
      src: undefined,
      title: 'Versions',
      items: [
        { src: '/tmp/a.md', label: 'A' },
        { src: '/tmp/b.md' },
      ],
    })
  })

  it('prefers items over src when both are present', () => {
    const code = JSON.stringify({
      src: '/tmp/single.md',
      items: [{ src: '/tmp/a.md' }],
    })
    const spec = parseMarkdownPreviewSpec(code)
    expect(spec?.items?.[0].src).toBe('/tmp/a.md')
  })

  it('returns null for invalid JSON', () => {
    expect(parseMarkdownPreviewSpec('not json {')).toBeNull()
  })

  it('returns null when neither src nor items is present', () => {
    expect(parseMarkdownPreviewSpec('{"title":"nope"}')).toBeNull()
  })

  it('returns null when src is empty', () => {
    expect(parseMarkdownPreviewSpec('{"src":""}')).toBeNull()
  })

  it('returns null when items is an empty array and no src', () => {
    expect(parseMarkdownPreviewSpec('{"items":[]}')).toBeNull()
  })

  it('filters items missing a string src', () => {
    const code = JSON.stringify({
      items: [
        { src: '/tmp/ok.md' },
        { label: 'no src' },
        { src: '' },
        { src: 42 },
      ],
    })
    const spec = parseMarkdownPreviewSpec(code)
    expect(spec?.items).toEqual([{ src: '/tmp/ok.md' }])
  })

  it('returns null when filtered items array becomes empty', () => {
    const code = JSON.stringify({
      items: [{ label: 'no src' }, { src: '' }],
    })
    expect(parseMarkdownPreviewSpec(code)).toBeNull()
  })

  it('ignores non-string title', () => {
    const code = JSON.stringify({ src: '/tmp/file.md', title: 123 })
    const spec = parseMarkdownPreviewSpec(code)
    expect(spec?.title).toBeUndefined()
  })

  it('returns null for non-object JSON values', () => {
    expect(parseMarkdownPreviewSpec('null')).toBeNull()
    expect(parseMarkdownPreviewSpec('"a string"')).toBeNull()
    expect(parseMarkdownPreviewSpec('42')).toBeNull()
    expect(parseMarkdownPreviewSpec('[1,2]')).toBeNull()
  })
})

describe('normalizePreviewItems', () => {
  it('returns empty array for null spec', () => {
    expect(normalizePreviewItems(null)).toEqual([])
  })

  it('wraps single src into a one-element array', () => {
    expect(normalizePreviewItems({ src: '/tmp/a.md' })).toEqual([{ src: '/tmp/a.md' }])
  })

  it('returns items as-is when items array is non-empty', () => {
    const items = [{ src: '/tmp/a.md' }, { src: '/tmp/b.md', label: 'B' }]
    expect(normalizePreviewItems({ items })).toEqual(items)
  })

  it('prefers items over src', () => {
    const items = [{ src: '/tmp/a.md' }]
    expect(normalizePreviewItems({ src: '/tmp/single.md', items })).toEqual(items)
  })

  it('returns empty array when both src and items are missing', () => {
    expect(normalizePreviewItems({})).toEqual([])
  })

  it('returns empty array for empty items + no src', () => {
    expect(normalizePreviewItems({ items: [] })).toEqual([])
  })
})


describe('shared document preview spec validation', () => {
  it('drops malformed items and non-string labels before rendering HTML or Markdown', () => {
    const spec = parseMarkdownPreviewSpec(JSON.stringify({ items: [
      null, 1, { src: 123 }, { src: '' },
      { src: '/report.html', label: { invalid: true } },
      { src: '/report.md', label: '报告' },
    ] }))
    expect(normalizePreviewItems(spec)).toEqual([
      { src: '/report.html' }, { src: '/report.md', label: '报告' },
    ])
  })
})

describe('isHtmlPreviewCoveredByArtifacts', () => {
  it('suppresses a single-item html-preview whose path matches a delivered artifact', () => {
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: '/Users/me/project/outputs/misaka-architecture.html' }],
      ['/Users/me/project/outputs/misaka-architecture.html'],
    )).toBe(true)
  })

  it('matches across file:// URLs, percent-encoding, Windows slashes/case, and baseDir-resolved relative paths', () => {
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: 'file:///Users/me/project/outputs/my%20diagram.html' }],
      ['/Users/me/project/outputs/my diagram.html'],
    )).toBe(true)
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: 'C:\\Users\\Me\\Docs\\Report.html' }],
      ['c:/users/me/docs/report.html'],
    )).toBe(true)
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: './outputs/misaka-architecture.html' }],
      ['/Users/me/project/outputs/misaka-architecture.html'],
      ['/Users/me/project'],
    )).toBe(true)
  })

  it('keeps scratch/unmatched previews, preserves POSIX case sensitivity, and never matches arbitrary relative suffixes', () => {
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: '/Users/me/.selection/workspaces/ws/sessions/s1/data/email.html' }],
      ['/Users/me/project/outputs/misaka-architecture.html'],
    )).toBe(false)
    // Distinct POSIX casing must not be conflated.
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: '/Users/me/project/Report.html' }],
      ['/Users/me/project/report.html'],
    )).toBe(false)
    // Relative path without matching baseDir must not match a same-name file in a different directory.
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: 'report.html' }],
      ['/Users/me/project/archive/report.html'],
      ['/Users/me/project'],
    )).toBe(false)
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: 'architecture.html' }],
      ['/Users/me/project/outputs/misaka-architecture.html'],
    )).toBe(false)
    expect(isHtmlPreviewCoveredByArtifacts(
      [{ src: '/Users/me/project/outputs/misaka-architecture.html' }],
      [],
    )).toBe(false)
  })

  it('keeps multi-item html-preview tab sets even if one or all files are delivered artifacts', () => {
    expect(isHtmlPreviewCoveredByArtifacts(
      [
        { src: '/Users/me/project/outputs/v1.html', label: 'V1' },
        { src: '/Users/me/project/outputs/v2.html', label: 'V2' },
      ],
      ['/Users/me/project/outputs/v1.html', '/Users/me/project/outputs/v2.html'],
    )).toBe(false)
  })
})
