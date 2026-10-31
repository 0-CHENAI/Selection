/**
 * #709 G1：模型侧页图。
 *
 * 用户在右侧「Office 协同」面板里看到的是 OfficeCLI watch 输出的 HTML。这里拿同一个
 * 引擎的 HTML（同一份字节已在面板打开时直接复用面板那份），交给宿主截成 PNG，再作为图片
 * 块交给模型原生读图。顺序来自 native-plan 的 preview 步骤：没有原生 Office 时走
 * officecli-html-electron-capturePage。不打包 LibreOffice，不用 Python，不用 OCR，
 * 也不启动外部浏览器。
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import { resolveOfficeRenderPlan } from './office-render'

const exec = promisify(execFile)

export type OfficeRenderKind = 'docx' | 'xlsx' | 'pptx'

/** Structurally the session-tools-core OfficeRenderOutcome consumed by office_render. */
export interface OfficeRenderOutcome {
  file: string
  kind: OfficeRenderKind
  renderer: string
  pageCount: number
  sheets?: string[]
  images: Array<{ label: string; path: string; width: number; height: number; data: string; truncated?: boolean }>
  missingFonts: string[]
  notRendered?: string[]
  notes?: string[]
  sharedWithPreviewPanel?: boolean
}

export const OFFICE_PAGE_RENDER_LIMITS = {
  maxInputBytes: 50 * 1024 * 1024,
  maxHtmlBytes: 32 * 1024 * 1024,
  maxImages: 6,
  timeoutMs: 90_000,
  /** Longest CSS-pixel edge captured for one image; Excel areas beyond this are cropped. */
  maxCssEdge: 2400,
} as const

export const OFFICE_PAGE_RENDER_STEP = 'officecli-html-electron-capturePage'

export interface OfficePageCaptureTarget {
  /** Page / slide number for Word and PowerPoint. */
  page?: number
  /** Sheet name for Excel; empty means the first sheet. */
  sheet?: string
  /** A1 range for Excel, without the sheet prefix. */
  range?: string
}

export interface OfficePageCaptureInput {
  kind: OfficeRenderKind
  /** Sanitized HTML: no remote scripts, no network fonts, CSP set. */
  html: string
  /** Called once the host knows how many pages / slides the document has. */
  selectPages(pageCount: number): number[]
  excel?: { sheet?: string; range?: string }
  maxCssEdge: number
  signal: AbortSignal
}

export interface OfficePageCaptureImage {
  label: string
  png: Uint8Array
  width: number
  height: number
  truncated?: boolean
}

export interface OfficePageCaptureResult {
  pageCount: number
  sheets?: string[]
  images: OfficePageCaptureImage[]
  missingFonts: string[]
  /** Requested targets the host could not find, e.g. an unknown sheet. */
  notFound?: string[]
  /** Short facts the model should know about how the pages were produced. */
  notes?: string[]
}

export interface OfficePageCaptureHost {
  readonly renderer: string
  capture(input: OfficePageCaptureInput): Promise<OfficePageCaptureResult>
}

let captureHost: OfficePageCaptureHost | null = null

/** Desktop main process installs the Electron capturePage host at startup. */
export function setOfficePageCaptureHost(host: OfficePageCaptureHost | null): void {
  captureHost = host
}

export function getOfficePageCaptureHost(): OfficePageCaptureHost | null {
  return captureHost
}

export function officeRenderKind(path: string): OfficeRenderKind | null {
  const ext = extname(path).toLowerCase()
  return ext === '.docx' || ext === '.xlsx' || ext === '.pptx' ? ext.slice(1) as OfficeRenderKind : null
}

/**
 * Resolve "1,3-5,last" / "all" against the real page count.
 * Returns the pages to render (capped) and human-readable notes for the rest.
 */
export function resolvePageSpec(spec: string | undefined, pageCount: number, max: number = OFFICE_PAGE_RENDER_LIMITS.maxImages): { pages: number[]; notRendered: string[] } {
  const wanted: number[] = []
  const notRendered: string[] = []
  const text = (spec ?? '').trim().toLowerCase()
  if (!text || text === 'all') {
    for (let page = 1; page <= pageCount; page++) wanted.push(page)
  } else {
    for (const raw of text.split(/[,，\s]+/).filter(Boolean)) {
      const token = raw.replace(/^p(?:age)?/, '')
      if (token === 'last' || token === '-1') { if (pageCount > 0) wanted.push(pageCount); continue }
      if (token === 'first') { if (pageCount > 0) wanted.push(1); continue }
      const range = /^(\d+)\s*[-–~]\s*(\d+|last)$/.exec(token)
      if (range) {
        const start = Number(range[1])
        const end = range[2] === 'last' ? pageCount : Number(range[2])
        for (let page = Math.min(start, end); page <= Math.max(start, end); page++) wanted.push(page)
        continue
      }
      if (/^\d+$/.test(token)) { wanted.push(Number(token)); continue }
      throw new Error(`无法识别的页码「${raw}」。用 1、1,3-5、last 或 all。`)
    }
  }
  const unique = [...new Set(wanted)]
  const valid = unique.filter(page => page >= 1 && page <= pageCount)
  for (const page of unique) if (page < 1 || page > pageCount) notRendered.push(`page ${page} (document has ${pageCount})`)
  const pages = valid.slice(0, max)
  const rest = valid.slice(max)
  if (rest.length) notRendered.push(`pages ${compactPages(rest)} (limit ${max} per call)`)
  return { pages, notRendered }
}

function compactPages(pages: number[]): string {
  const parts: string[] = []
  let start = pages[0]!
  let prev = start
  for (const page of [...pages.slice(1), Number.NaN]) {
    if (page === prev + 1) { prev = page; continue }
    parts.push(start === prev ? String(start) : `${start}-${prev}`)
    start = prev = page
  }
  return parts.join(',')
}

/** Split "Sheet 1!A1:P51" / "'Sheet 1'!A1:P51" / "A1:P51". */
export function splitSheetRange(range: string | undefined, sheet: string | undefined): { sheet?: string; range?: string } {
  const value = range?.trim()
  if (!value) return { sheet: sheet?.trim() || undefined }
  const bang = value.lastIndexOf('!')
  const cells = (bang >= 0 ? value.slice(bang + 1) : value).replace(/\$/g, '').toUpperCase()
  if (!/^[A-Z]{1,3}\d{1,7}(?::[A-Z]{1,3}\d{1,7})?$/.test(cells)) throw new Error(`无法识别的单元格区域「${value}」。用 A1:P51 这样的写法。`)
  const prefix = bang >= 0 ? value.slice(0, bang).replace(/^'(.*)'$/, '$1').trim() : ''
  return { sheet: prefix || sheet?.trim() || undefined, range: cells.includes(':') ? cells : `${cells}:${cells}` }
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`

/**
 * Same sanitizing the preview panel applies before it shows the HTML: remote
 * scripts (CDN / font loaders) are removed and a no-network CSP is set.
 */
export function sanitizeOfficeHtml(html: string): string {
  const stripped = html
    .replace(/<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>(?:(?!<\/script)[\s\S])*?(?:fonts\.googleapis\.com|d\.officecli\.ai)[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<link\b[^>]*\bhref\s*=\s*["']?https?:[^>]*>/gi, '')
  if (/<head\b[^>]*>/i.test(stripped)) return stripped.replace(/<head\b[^>]*>/i, match => `${match}${CSP}`)
  return `${CSP}${stripped}`
}

async function officecliHtml(file: string, signal: AbortSignal): Promise<string> {
  const binary = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
  if (!binary || /\.(cmd|bat)$/i.test(binary)) throw new Error('OfficeCLI 不可用，无法渲染页图')
  const { stdout } = await exec(binary, ['view', file, 'html'], {
    env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
    timeout: 60_000,
    maxBuffer: OFFICE_PAGE_RENDER_LIMITS.maxHtmlBytes,
    windowsHide: true,
    signal,
  })
  return stdout
}

export interface RenderOfficePagesOptions {
  path: string
  /** Base for a relative path. */
  cwd?: string
  /** Directory the PNG files are written to. */
  outDir: string
  pages?: string
  sheet?: string
  range?: string
  signal?: AbortSignal
  /** HTML the preview panel already holds for these exact bytes, if any. */
  previewHtml?: (path: string, sha256: string) => string | undefined
  host?: OfficePageCaptureHost | null
  /** Test seam for OfficeCLI. */
  loadHtml?: (file: string, signal: AbortSignal) => Promise<string>
}

let queue: Promise<unknown> = Promise.resolve()

/** One render at a time; a stuck render is cut off by the timeout and does not block the next. */
export function renderOfficePages(options: RenderOfficePagesOptions): Promise<OfficeRenderOutcome> {
  const run = queue.catch(() => {}).then(() => renderNow(options))
  queue = run.catch(() => {})
  return run
}

async function renderNow(options: RenderOfficePagesOptions): Promise<OfficeRenderOutcome> {
  const host = options.host === undefined ? captureHost : options.host
  if (!host) throw new Error('当前进程没有页图宿主（需要 Selection 桌面版）。')
  const plan = resolveOfficeRenderPlan()
  if (!plan.preview.some(step => step.id === OFFICE_PAGE_RENDER_STEP)) throw new Error('当前渲染顺序里没有 OfficeCLI HTML + Electron 截图这一步。')
  const file = isAbsolute(options.path) ? options.path : resolve(options.cwd ?? process.cwd(), options.path)
  const kind = officeRenderKind(file)
  if (!kind) throw new Error('只支持 .docx、.xlsx、.pptx')
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) throw new Error(`找不到文件：${file}`)
  if (info.size > OFFICE_PAGE_RENDER_LIMITS.maxInputBytes) throw new Error(`文件超过 ${OFFICE_PAGE_RENDER_LIMITS.maxInputBytes} 字节，无法渲染`)
  if (kind !== 'xlsx' && (options.sheet || options.range)) throw new Error('sheet / range 只用于 Excel；Word 和 PowerPoint 用 pages。')
  if (kind === 'xlsx' && options.pages) throw new Error('Excel 用 sheet 和 range 指定区域，不用 pages。')
  const excel = kind === 'xlsx' ? splitSheetRange(options.range, options.sheet) : undefined

  const controller = new AbortController()
  const outer = options.signal
  const onAbort = () => controller.abort(outer?.reason)
  if (outer?.aborted) throw new Error('渲染已取消')
  outer?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('timeout')), OFFICE_PAGE_RENDER_LIMITS.timeoutMs)
  let scratch: string | undefined
  try {
    const bytes = await readFile(file)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    let html = options.previewHtml?.(file, sha256)
    const shared = !!html
    if (!html) {
      // Render a private copy so a half-written live file cannot change under OfficeCLI.
      scratch = await mkdtemp(join(tmpdir(), 'selection-office-render-'))
      const copy = join(scratch, `document.${kind}`)
      await writeFile(copy, bytes, { mode: 0o600 })
      html = await (options.loadHtml ?? officecliHtml)(copy, controller.signal)
    }
    if (html.length > OFFICE_PAGE_RENDER_LIMITS.maxHtmlBytes) throw new Error('文档渲染结果过大，请缩小范围')
    let notRendered: string[] = []
    const captured = await abortable(host.capture({
      kind,
      html: sanitizeOfficeHtml(html),
      selectPages: count => {
        const resolved = resolvePageSpec(options.pages, count)
        notRendered = resolved.notRendered
        return resolved.pages
      },
      excel,
      maxCssEdge: OFFICE_PAGE_RENDER_LIMITS.maxCssEdge,
      signal: controller.signal,
    }), controller.signal)
    if (captured.notFound?.length) notRendered = [...notRendered, ...captured.notFound]
    if (!captured.images.length) {
      throw new Error(notRendered.length ? `没有可渲染的页：${notRendered.join('；')}` : '没有渲染出任何页')
    }
    await mkdir(options.outDir, { recursive: true })
    const stem = basename(file, extname(file)).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60) || 'document'
    const images = []
    for (const image of captured.images) {
      const safeLabel = image.label.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'page'
      const out = join(options.outDir, `${stem}-${sha256.slice(0, 8)}-${safeLabel}.png`)
      await writeFile(out, image.png)
      images.push({
        label: image.label,
        path: out,
        width: image.width,
        height: image.height,
        data: Buffer.from(image.png).toString('base64'),
        ...(image.truncated ? { truncated: true } : {}),
      })
    }
    return {
      file,
      kind,
      renderer: host.renderer,
      pageCount: captured.pageCount,
      ...(captured.sheets ? { sheets: captured.sheets } : {}),
      images,
      missingFonts: captured.missingFonts,
      ...(notRendered.length ? { notRendered } : {}),
      ...(captured.notes?.length ? { notes: captured.notes } : {}),
      ...(shared ? { sharedWithPreviewPanel: true } : {}),
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(outer?.aborted ? '渲染已取消' : `渲染超过 ${OFFICE_PAGE_RENDER_LIMITS.timeoutMs / 1000} 秒，已停止`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      value => { signal.removeEventListener('abort', onAbort); resolvePromise(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}
