import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OFFICE_PAGE_RENDER_STEP,
  officeRenderKind,
  renderOfficePages,
  resolvePageSpec,
  sanitizeOfficeHtml,
  splitSheetRange,
  type OfficePageCaptureHost,
  type OfficePageCaptureInput,
} from './office-page-render'
import { officePageScript } from './office-page-render-script'
import { resolveOfficeRenderPlan } from './office-render'

const dir = mkdtempSync(join(tmpdir(), 'office-page-render-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const docx = join(dir, '报告 v1.docx')
const xlsx = join(dir, 'book.xlsx')
writeFileSync(docx, 'docx-bytes')
writeFileSync(xlsx, 'xlsx-bytes')
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function fakeHost(pageCount: number, seen: OfficePageCaptureInput[] = []): OfficePageCaptureHost {
  return {
    renderer: OFFICE_PAGE_RENDER_STEP,
    async capture(input) {
      seen.push(input)
      if (input.kind === 'xlsx') return { pageCount: 2, sheets: ['经营总览', '增长测算'], images: [{ label: `${input.excel?.sheet ?? '经营总览'}!${input.excel?.range}`, png, width: 800, height: 600 }], missingFonts: [] }
      const pages = input.selectPages(pageCount)
      return { pageCount, images: pages.map(page => ({ label: String(page), png, width: 1161, height: 1641 })), missingFonts: ['Hiragino Sans GB'] }
    },
  }
}

describe('page selection', () => {
  test('resolves first / last / ranges / all with a per-call cap', () => {
    expect(resolvePageSpec('1,last', 7)).toEqual({ pages: [1, 7], notRendered: [] })
    expect(resolvePageSpec('2-4, 4', 7).pages).toEqual([2, 3, 4])
    expect(resolvePageSpec('5-last', 7).pages).toEqual([5, 6, 7])
    expect(resolvePageSpec(undefined, 3).pages).toEqual([1, 2, 3])
    const capped = resolvePageSpec('all', 9)
    expect(capped.pages).toEqual([1, 2, 3, 4, 5, 6])
    expect(capped.notRendered).toEqual(['pages 7-9 (limit 6 per call)'])
    expect(resolvePageSpec('1,9', 7)).toEqual({ pages: [1], notRendered: ['page 9 (document has 7)'] })
    expect(() => resolvePageSpec('cover', 7)).toThrow('无法识别的页码')
  })

  test('splits Excel sheet prefixes and normalizes ranges', () => {
    expect(splitSheetRange('A1:P51', '经营总览')).toEqual({ sheet: '经营总览', range: 'A1:P51' })
    expect(splitSheetRange("'Sheet 1'!$a$1:$c$3", undefined)).toEqual({ sheet: 'Sheet 1', range: 'A1:C3' })
    expect(splitSheetRange('B2', undefined)).toEqual({ sheet: undefined, range: 'B2:B2' })
    expect(splitSheetRange(undefined, ' 增长测算 ')).toEqual({ sheet: '增长测算' })
    expect(() => splitSheetRange('A1:', undefined)).toThrow('单元格区域')
  })

  test('only Office packages are accepted', () => {
    expect(officeRenderKind('/a/B.DOCX')).toBe('docx')
    expect(officeRenderKind('/a/b.pdf')).toBeNull()
  })
})

test('sanitizing matches the preview panel: no remote scripts or fonts, no-network CSP', () => {
  const html = `<html><head><script src="https://cdn.example/katex.js"></script><script>var q='https://fonts.googleapis.com/css2?family=Calibri'</script><link rel="stylesheet" href="https://fonts.googleapis.com/x.css"><script>function switchSheet(i){}</script></head><body><div class="page" data-page="1"></div></body></html>`
  const clean = sanitizeOfficeHtml(html)
  expect(clean).not.toContain('cdn.example')
  expect(clean).not.toContain('fonts.googleapis.com')
  expect(clean).toContain('function switchSheet')
  expect(clean).toContain("connect-src 'none'")
  expect(clean.indexOf('Content-Security-Policy')).toBeLessThan(clean.indexOf('<body>'))
})

test('the in-page script is a self-contained expression with the request inlined safely', () => {
  const source = officePageScript({ op: 'measure', kind: 'xlsx', sheet: '</script><b>', range: 'A1:B2', maxCssEdge: 2400 })
  expect(source.startsWith('(async function (req)')).toBe(true)
  expect(source).not.toContain('</script>')
  expect(() => new Function(`return ${source}`)).not.toThrow()
  expect(source).toContain('if (content) anchorFloats(content);')
})

test('the capture step is part of the approved native-first preview order', () => {
  expect(resolveOfficeRenderPlan().preview.map(step => step.id)).toContain(OFFICE_PAGE_RENDER_STEP)
})

describe('renderOfficePages', () => {
  test('renders requested Word pages from OfficeCLI HTML and saves PNGs', async () => {
    const seen: OfficePageCaptureInput[] = []
    const out = join(dir, 'out-word')
    const loaded: string[] = []
    const result = await renderOfficePages({
      path: '报告 v1.docx', cwd: dir, outDir: out, pages: '1,last',
      host: fakeHost(7, seen),
      loadHtml: async file => { loaded.push(file); return '<html><head></head><body><script src="https://x/y.js"></script></body></html>' },
    })
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).not.toBe(docx) // a private copy, never the live file
    expect(seen[0]!.html).not.toContain('https://x/y.js')
    expect(result.kind).toBe('docx')
    expect(result.renderer).toBe(OFFICE_PAGE_RENDER_STEP)
    expect(result.pageCount).toBe(7)
    expect(result.images.map(image => image.label)).toEqual(['1', '7'])
    expect(result.missingFonts).toEqual(['Hiragino Sans GB'])
    expect(result.sharedWithPreviewPanel).toBeUndefined()
    for (const image of result.images) {
      expect(image.path.startsWith(out)).toBe(true)
      expect(new Uint8Array(readFileSync(image.path))).toEqual(png)
      expect(image.data).toBe(Buffer.from(png).toString('base64'))
    }
  })

  test('reuses the preview panel HTML for identical bytes', async () => {
    let asked: [string, string] | undefined
    const result = await renderOfficePages({
      path: docx, outDir: join(dir, 'out-shared'), pages: '2',
      host: fakeHost(3),
      previewHtml: (path, sha) => { asked = [path, sha]; return '<html><head></head><body>panel</body></html>' },
      loadHtml: async () => { throw new Error('should not run OfficeCLI') },
    })
    expect(asked?.[0]).toBe(docx)
    expect(asked?.[1]).toMatch(/^[a-f0-9]{64}$/)
    expect(result.sharedWithPreviewPanel).toBe(true)
  })

  test('Excel uses sheet + range, not pages', async () => {
    const seen: OfficePageCaptureInput[] = []
    const result = await renderOfficePages({ path: xlsx, outDir: join(dir, 'out-xlsx'), range: '经营总览!A1:P51', host: fakeHost(0, seen), loadHtml: async () => '<html></html>' })
    expect(seen[0]!.excel).toEqual({ sheet: '经营总览', range: 'A1:P51' })
    expect(result.sheets).toEqual(['经营总览', '增长测算'])
    await expect(renderOfficePages({ path: xlsx, outDir: dir, pages: '1', host: fakeHost(0), loadHtml: async () => '' })).rejects.toThrow('sheet 和 range')
    await expect(renderOfficePages({ path: docx, outDir: dir, sheet: 'x', host: fakeHost(1), loadHtml: async () => '' })).rejects.toThrow('只用于 Excel')
  })

  test('fails clearly without a desktop host, for missing files and for nothing to render', async () => {
    await expect(renderOfficePages({ path: docx, outDir: dir, host: null })).rejects.toThrow('桌面版')
    await expect(renderOfficePages({ path: join(dir, 'missing.docx'), outDir: dir, host: fakeHost(1) })).rejects.toThrow('找不到文件')
    await expect(renderOfficePages({ path: docx, outDir: dir, pages: '9', host: fakeHost(7), loadHtml: async () => '<html></html>' })).rejects.toThrow('page 9')
  })

  test('cancellation stops a hung capture and the next render still runs', async () => {
    const controller = new AbortController()
    const hung: OfficePageCaptureHost = { renderer: 'hang', capture: () => new Promise(() => {}) }
    const pending = renderOfficePages({ path: docx, outDir: dir, host: hung, signal: controller.signal, loadHtml: async () => '<html></html>' })
    setTimeout(() => controller.abort(), 20)
    await expect(pending).rejects.toThrow('已取消')
    const next = await renderOfficePages({ path: docx, outDir: join(dir, 'out-after'), pages: '1', host: fakeHost(1), loadHtml: async () => '<html></html>' })
    expect(next.images).toHaveLength(1)
  })
})
