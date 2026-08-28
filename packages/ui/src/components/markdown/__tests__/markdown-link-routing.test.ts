import { describe, it, expect } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import { classifyMarkdownLinkTarget, resolveMarkdownLinkTarget } from '../link-target'
import { preprocessLinks } from '../linkify'
import { markdownUrlTransform } from '../url-transform'

describe('resolveMarkdownLinkTarget', () => {
  it('resolves absolute unix file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('/Users/balintorosz/.craft-agent/sessions/abc/image.jpg')).toEqual({
      kind: 'file',
      path: '/Users/balintorosz/.craft-agent/sessions/abc/image.jpg',
    })
  })

  it('resolves parent-relative file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('../downloads/assets/screenshot.png')).toEqual({
      kind: 'file',
      path: '../downloads/assets/screenshot.png',
    })
  })

  it('resolves repo-relative file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('apps/electron/resources/docs/browser-tools.md')).toEqual({
      kind: 'file',
      path: 'apps/electron/resources/docs/browser-tools.md',
    })
  })

  it('resolves unix file URLs as file targets', () => {
    expect(resolveMarkdownLinkTarget('file:///Users/tester/report.xlsx')).toEqual({
      kind: 'file',
      path: '/Users/tester/report.xlsx',
    })
  })

  it('decodes percent-encoded unix file URLs', () => {
    expect(resolveMarkdownLinkTarget('file:///Users/tester/report%20final.pdf')).toEqual({
      kind: 'file',
      path: '/Users/tester/report final.pdf',
    })
  })

  it('decodes a percent-encoded space in a BARE local file path (#944)', () => {
    expect(resolveMarkdownLinkTarget('/Users/tester/My%20Docs/report%20final.pptx')).toEqual({
      kind: 'file',
      path: '/Users/tester/My Docs/report final.pptx',
    })
  })

  it('leaves a bare path with an invalid percent-sequence untouched (#944)', () => {
    expect(resolveMarkdownLinkTarget('/Users/tester/100%done/notes.md')).toEqual({
      kind: 'file',
      path: '/Users/tester/100%done/notes.md',
    })
  })

  it('normalizes windows drive-letter file URLs to local paths', () => {
    expect(resolveMarkdownLinkTarget('file:///C:/Users/Tester/Deck.pptx')).toEqual({
      kind: 'file',
      path: 'C:/Users/Tester/Deck.pptx',
    })
  })

  it('normalizes file://localhost/C:/… Windows URLs', () => {
    expect(resolveMarkdownLinkTarget('file://localhost/C:/Users/Tester/Deck.pptx')).toEqual({
      kind: 'file',
      path: 'C:/Users/Tester/Deck.pptx',
    })
  })

  it('normalizes file://D:/… (hostname-as-drive) Windows URLs', () => {
    expect(resolveMarkdownLinkTarget('file://D:/selection/巡察工作/a.md')).toEqual({
      kind: 'file',
      path: 'D:/selection/巡察工作/a.md',
    })
  })

  it('normalizes Windows file URLs that use backslashes', () => {
    expect(resolveMarkdownLinkTarget('file:///D:\\selection\\巡察工作\\a.md')).toEqual({
      kind: 'file',
      path: 'D:/selection/巡察工作/a.md',
    })
  })

  it('treats a bare Windows drive path as a file', () => {
    expect(resolveMarkdownLinkTarget('D:\\selection\\巡察工作\\skills\\SKILL.md')).toEqual({
      kind: 'file',
      path: 'D:\\selection\\巡察工作\\skills\\SKILL.md',
    })
  })

  it('treats a Chinese relative workspace path as a file', () => {
    expect(resolveMarkdownLinkTarget('巡察工作/skills/inspection-workflow/SKILL.md')).toEqual({
      kind: 'file',
      path: '巡察工作/skills/inspection-workflow/SKILL.md',
    })
  })

  it('decodes percent-encoded Chinese segments in a relative file path', () => {
    expect(resolveMarkdownLinkTarget('skills/%E5%B7%A1%E5%AF%9F%E5%B7%A5%E4%BD%9C/SKILL.md')).toEqual({
      kind: 'file',
      path: 'skills/巡察工作/SKILL.md',
    })
  })

  it('resolves https links as url targets', () => {
    expect(resolveMarkdownLinkTarget('https://example.com/image.jpg')).toEqual({
      kind: 'url',
      url: 'https://example.com/image.jpg',
    })
  })

  it('resolves mailto links as url targets', () => {
    expect(resolveMarkdownLinkTarget('mailto:test@example.com')).toEqual({
      kind: 'url',
      url: 'mailto:test@example.com',
    })
  })

  it('treats fuzzy http://SKILL.md autolinks as local file names', () => {
    expect(resolveMarkdownLinkTarget('http://SKILL.md')).toEqual({
      kind: 'file',
      path: 'SKILL.md',
    })
  })

  it('does not treat a real hostname as a file', () => {
    expect(resolveMarkdownLinkTarget('https://example.com')).toEqual({
      kind: 'url',
      url: 'https://example.com',
    })
  })

  it('does not treat multi-label hosts as local files', () => {
    expect(resolveMarkdownLinkTarget('http://jquery.min.js')).toEqual({
      kind: 'url',
      url: 'http://jquery.min.js',
    })
  })
})

describe('markdownUrlTransform', () => {
  it('preserves dangerous anchor hrefs for custom click routing', () => {
    const anchorNode = { tagName: 'a' }
    expect(markdownUrlTransform('file:///tmp/test.md', 'href', anchorNode as never)).toBe('file:///tmp/test.md')
    expect(markdownUrlTransform('javascript:alert(1)', 'href', anchorNode as never)).toBe('javascript:alert(1)')
  })

  it('still sanitizes dangerous non-anchor URL attributes', () => {
    const imageNode = { tagName: 'img' }
    expect(markdownUrlTransform('javascript:alert(1)', 'src', imageNode as never)).toBe('')
  })

  it('keeps safe anchor hrefs unchanged', () => {
    const anchorNode = { tagName: 'a' }
    expect(markdownUrlTransform('https://example.com', 'href', anchorNode as never)).toBe('https://example.com')
  })
})

describe('ReactMarkdown anchor rendering with markdownUrlTransform', () => {
  function render(markdown: string): string {
    return renderToStaticMarkup(React.createElement(ReactMarkdown, {
      urlTransform: markdownUrlTransform,
      components: {
        a: ({ href, children }) => React.createElement('a', {
          href: href ? defaultUrlTransform(href) || undefined : undefined,
          'data-raw-href': href,
        }, children),
      },
      children: markdown,
    }))
  }

  it('lets file links reach the custom anchor while keeping the DOM href sanitized', () => {
    const html = render('[report](file:///Users/tester/report.pdf)')
    expect(html).toContain('data-raw-href="file:///Users/tester/report.pdf"')
    expect(html).not.toContain('<a href="file:///Users/tester/report.pdf"')
  })

  it('lets javascript links reach the custom anchor while keeping the DOM href sanitized', () => {
    const html = render('[boom](javascript:alert(1))')
    expect(html).toContain('data-raw-href="javascript:alert(1)"')
    expect(html).not.toContain('<a href="javascript:alert')
  })

  it('keeps safe web links in the DOM href for normal browser affordances', () => {
    const html = render('[site](https://example.com/path)')
    expect(html).toContain('href="https://example.com/path"')
  })
})

describe('classifyMarkdownLinkTarget', () => {
  it('classifies absolute unix file paths as file', () => {
    expect(classifyMarkdownLinkTarget('/Users/balintorosz/.craft-agent/sessions/abc/image.jpg')).toBe('file')
  })

  it('classifies file URLs as file', () => {
    expect(classifyMarkdownLinkTarget('file:///Users/tester/report.xlsx')).toBe('file')
  })

  it('classifies https links as url', () => {
    expect(classifyMarkdownLinkTarget('https://example.com/image.jpg')).toBe('url')
  })

  it('classifies mailto links as url', () => {
    expect(classifyMarkdownLinkTarget('mailto:test@example.com')).toBe('url')
  })
})

describe('generated markdown file-link pipeline', () => {
  function rawHrefs(markdown: string): string[] {
    const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
      urlTransform: markdownUrlTransform,
      components: {
        a: ({ href, children }) => React.createElement('a', {
          href: href ? defaultUrlTransform(href) || undefined : undefined,
          'data-raw-href': href,
        }, children),
      },
      children: preprocessLinks(markdown),
    }))
    return [...html.matchAll(/data-raw-href="([^"]*)"/g)].map((match) =>
      match[1]!.replace(/&amp;/g, '&').replace(/&#x27;/g, "'"),
    )
  }

  it('opens an explicit Windows + Chinese workspace path as a file', () => {
    const hrefs = rawHrefs('[技能](D:\\selection\\巡察工作\\skills\\SKILL.md)')
    expect(hrefs).toHaveLength(1)
    expect(resolveMarkdownLinkTarget(hrefs[0]!)).toEqual({
      kind: 'file',
      path: 'D:/selection/巡察工作/skills/SKILL.md',
    })
  })

  it('opens an unquoted destination that contains spaces', () => {
    const hrefs = rawHrefs('[技能](D:\\selection\\巡察工作\\my file.md)')
    expect(hrefs).toHaveLength(1)
    expect(resolveMarkdownLinkTarget(hrefs[0]!)).toEqual({
      kind: 'file',
      path: 'D:/selection/巡察工作/my file.md',
    })
  })

  it('does not let CommonMark remove the separator before .selection', () => {
    const path = 'C:\\Users\\fairy\\.selection\\workspaces\\my-workspace\\sessions\\current\\attachments\\Harness.docx'
    const hrefs = rawHrefs(`[Harness.docx](${path})`)
    expect(hrefs).toHaveLength(1)
    expect(resolveMarkdownLinkTarget(hrefs[0]!)).toEqual({
      kind: 'file',
      path: 'C:/Users/fairy/.selection/workspaces/my-workspace/sessions/current/attachments/Harness.docx',
    })
  })

  it('opens the full parenthesized Chinese filename from issue 134', () => {
    const path = 'C:\\Users\\fairy\\attachments\\云南华电2025年度光伏EPC总承包框架招标文件 (1)_法律审查批注.docx'
    const hrefs = rawHrefs(`[打开 Word 批注版](${path})`)
    expect(hrefs).toHaveLength(1)
    expect(resolveMarkdownLinkTarget(hrefs[0]!)).toEqual({
      kind: 'file',
      path: path.replace(/\\/g, '/'),
    })
  })

  it('keeps the full path when hidden directories and parentheses are present', () => {
    const hrefs = rawHrefs(
      '[报告](C:\\Users\\fairy\\.selection\\sessions\\云南华电 (1)_法律审查汇总.xlsx)',
    )
    expect(hrefs).toHaveLength(1)
    expect(resolveMarkdownLinkTarget(hrefs[0]!)).toEqual({
      kind: 'file',
      path: 'C:/Users/fairy/.selection/sessions/云南华电 (1)_法律审查汇总.xlsx',
    })
  })

  it('opens file://D:/ hostname-as-drive URLs as files', () => {
    const hrefs = rawHrefs('[报告](file://D:/selection/巡察工作/a.md)')
    expect(hrefs).toHaveLength(1)
    expect(resolveMarkdownLinkTarget(hrefs[0]!)).toEqual({
      kind: 'file',
      path: 'D:/selection/巡察工作/a.md',
    })
  })

  it('opens percent-encoded Chinese relative paths as files', () => {
    const hrefs = rawHrefs('[技能](skills/%E5%B7%A1%E5%AF%9F%E5%B7%A5%E4%BD%9C/SKILL.md)')
    expect(hrefs).toHaveLength(1)
    expect(resolveMarkdownLinkTarget(hrefs[0]!)).toEqual({
      kind: 'file',
      path: 'skills/巡察工作/SKILL.md',
    })
  })

  it('opens a bare Chinese workspace path after autolink', () => {
    const hrefs = rawHrefs('见 巡察工作/skills/SKILL.md 说明')
    expect(hrefs.some((href) => resolveMarkdownLinkTarget(href).kind === 'file')).toBe(true)
    const file = hrefs.map((href) => resolveMarkdownLinkTarget(href)).find((target) => target.kind === 'file')
    expect(file).toEqual({
      kind: 'file',
      path: '巡察工作/skills/SKILL.md',
    })
  })
})
