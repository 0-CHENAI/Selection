/**
 * 阶段 02 的统一入口。默认关闭，不从 services/index.ts 导出。
 * PDF 默认走可注入的 PrintHost；未注入时用分页替身，方便在没有 Electron 的 CI 里证明合同。
 * 拍板后的接入才把宿主换成 Electron webContents.printToPDF / capturePage。
 */

import { OFFICE_RENDER_LIMITS, OfficeRenderPocError, assertOfficeRenderPoc, assertSourceGuard, type PocEnv, type SourceGuard } from './gate.ts'
import { recalculateWorkbook, type CellInput, type CheckSpec, type RecalcResult } from './formula.ts'
import {
  cropRange,
  htmlToPdf,
  pageIsBlank,
  preparePrintHtml,
  readPdfPages,
  type AnchorBox,
  type PrintToPdfOptions,
} from './print.ts'

export interface PrintHost {
  readonly renderer: string
  printToPdf(html: string, options: PrintToPdfOptions, signal: AbortSignal): Promise<Uint8Array>
}

export type PdfExportResult = {
  pdf: Uint8Array
  pageCount: number
  texts: string[]
  renderer: string
  requestedFonts: string[]
  embeddedFonts: string[]
  networkFontRequestsRemoved: boolean
  options: PrintToPdfOptions
}

export type PreviewResult = {
  renderer: string
  pageCount?: number
  texts?: string[]
  blank: boolean
  crop?: { x: number; y: number; width: number; height: number } | null
}

export type RenderGuard = SourceGuard & { env?: PocEnv; timeoutMs?: number }

const fallbackHost: PrintHost = {
  renderer: 'selection-html-paginator',
  printToPdf(html) {
    return Promise.resolve(htmlToPdf(html))
  },
}

export async function exportPdf(input: RenderGuard & { html: string; host?: PrintHost }): Promise<PdfExportResult> {
  assertOfficeRenderPoc(input.env)
  assertSourceGuard(input)
  const prepared = preparePrintHtml(input.html)
  const host = input.host ?? fallbackHost
  const signal = input.signal ?? new AbortController().signal
  const pdf = await withTimeout(host.printToPdf(prepared.html, prepared.options, signal), input.timeoutMs ?? OFFICE_RENDER_LIMITS.timeoutMs, signal)
  const pages = await readPdfPages(pdf)
  return {
    pdf,
    pageCount: pages.pageCount,
    texts: pages.texts,
    renderer: host.renderer,
    requestedFonts: prepared.requestedFonts,
    embeddedFonts: prepared.embeddedFonts,
    networkFontRequestsRemoved: prepared.networkFontRequestsRemoved,
    options: prepared.options,
  }
}

export async function renderPreview(input: RenderGuard & {
  pdf?: Uint8Array
  pixels?: ArrayLike<number>
  channels?: number
  anchors?: AnchorBox[]
  range?: string
  varianceThreshold?: number
}): Promise<PreviewResult> {
  assertOfficeRenderPoc(input.env)
  assertSourceGuard(input)
  const pages = input.pdf ? await readPdfPages(input.pdf) : undefined
  const blank = input.pixels ? pageIsBlank(input.pixels, input.channels ?? 1, input.varianceThreshold ?? 12) : false
  if (input.pixels && blank) throw new OfficeRenderPocError('blank-page', '预览是空白页，已停止')
  return {
    renderer: input.pdf ? 'pdfjs' : 'selection-pixels',
    pageCount: pages?.pageCount,
    texts: pages?.texts,
    blank,
    crop: input.range && input.anchors ? cropRange(input.anchors, input.range) : undefined,
  }
}

export function recalculate(input: RenderGuard & { cells: CellInput[]; checks?: CheckSpec[] }): RecalcResult {
  assertOfficeRenderPoc(input.env)
  assertSourceGuard(input)
  return recalculateWorkbook(input.cells, input.checks ?? [])
}

/** A4 / B4 / C4：只探测命令是否存在，不调用，也不作为默认渲染器。 */
export async function detectOfficeRenderers(exists: (command: string) => Promise<boolean>): Promise<{
  word: boolean
  powerpoint: boolean
  excel: boolean
  libreoffice: boolean
}> {
  const [word, powerpoint, excel, soffice, libreoffice] = await Promise.all([
    exists('winword'),
    exists('powerpnt'),
    exists('excel'),
    exists('soffice'),
    exists('libreoffice'),
  ])
  return { word, powerpoint, excel, libreoffice: soffice || libreoffice }
}

export function createOfficeRenderPoc(limits: { concurrency?: number } = {}) {
  const concurrency = limits.concurrency ?? OFFICE_RENDER_LIMITS.concurrency
  let active = 0
  const waiters: Array<() => void> = []
  async function limit<T>(run: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>(resolve => waiters.push(resolve))
    active++
    try { return await run() }
    finally {
      active--
      waiters.shift()?.()
    }
  }
  return {
    exportPdf: (input: Parameters<typeof exportPdf>[0]) => limit(() => exportPdf(input)),
    renderPreview: (input: Parameters<typeof renderPreview>[0]) => limit(() => renderPreview(input)),
    recalculate: (input: Parameters<typeof recalculate>[0]) => limit(() => Promise.resolve(recalculate(input))),
  }
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new OfficeRenderPocError('cancelled', '转换已取消')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OfficeRenderPocError('timeout', `转换超过 ${timeoutMs} 毫秒`)), timeoutMs)
  })
  const cancelled = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new OfficeRenderPocError('cancelled', '转换已取消')), { once: true })
  })
  try { return await Promise.race([task, timeout, cancelled]) }
  finally { if (timer) clearTimeout(timer) }
}
