/// <reference path="../../reliability/pdf-worker.d.ts" />

/** A1 / B2 / B3：把 OfficeCLI HTML 收成可打印文档，并用已有 pdfjs 读回页数。 */

export type PageBox = {
  widthPt: number
  heightPt: number
  paddingPt: { top: number; right: number; bottom: number; left: number }
}

export type PrintToPdfOptions = {
  printBackground: true
  preferCSSPageSize: true
  pageSize: { widthMicrons: number; heightMicrons: number }
  marginsMicrons: { top: number; right: number; bottom: number; left: number }
}

export type PreparedPrint = {
  html: string
  box: PageBox
  options: PrintToPdfOptions
  requestedFonts: string[]
  embeddedFonts: string[]
  networkFontRequestsRemoved: boolean
}

const PT_TO_MICRONS = 25_400 / 72
const DEFAULT_BOX: PageBox = {
  widthPt: 595.3,
  heightPt: 841.9,
  paddingPt: { top: 72, right: 90, bottom: 72, left: 90 },
}

export function readPageBox(html: string): PageBox {
  const style = /class="page"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? ''
  const width = /width\s*:\s*([0-9.]+)pt/.exec(style)?.[1]
  const height = /min-height\s*:\s*([0-9.]+)pt/.exec(style)?.[1]
  const padding = /padding\s*:\s*([^;]+)/.exec(style)?.[1]
  return {
    widthPt: width ? Number(width) : DEFAULT_BOX.widthPt,
    heightPt: height ? Number(height) : DEFAULT_BOX.heightPt,
    paddingPt: padding ? parsePadding(padding) : DEFAULT_BOX.paddingPt,
  }
}

export function preparePrintHtml(html: string): PreparedPrint {
  const box = readPageBox(html)
  const requestedFonts = [...html.matchAll(/local\('([^']+)'\)/g)].map(match => match[1]!)
  const uniqueFonts = [...new Set(requestedFonts.map(font => font.replace(/\s+(Bold Italic|Bold|Italic)$/i, '')))]
  const networkFontRequestsRemoved = /fonts\.googleapis\.com|d\.officecli\.ai/.test(html)
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?(?:fonts\.googleapis\.com|d\.officecli\.ai)[\s\S]*?<\/script>/gi, '')
  const printCss = `<style id="selection-print">@page{size:${box.widthPt}pt ${box.heightPt}pt;margin:0}html,body{margin:0;padding:0;background:#fff}.page-wrapper{margin:0!important}.page{box-shadow:none!important;min-height:${box.heightPt}pt!important}</style>`
  const withCss = stripped.includes('</head>') ? stripped.replace('</head>', `${printCss}</head>`) : `${printCss}${stripped}`
  return {
    html: withCss,
    box,
    options: printOptions(box),
    requestedFonts: uniqueFonts,
    embeddedFonts: [],
    networkFontRequestsRemoved,
  }
}

export function printOptions(box: PageBox): PrintToPdfOptions {
  const microns = (pt: number) => Math.round(pt * PT_TO_MICRONS)
  return {
    printBackground: true,
    preferCSSPageSize: true,
    pageSize: { widthMicrons: microns(box.widthPt), heightMicrons: microns(box.heightPt) },
    marginsMicrons: {
      top: microns(box.paddingPt.top),
      right: microns(box.paddingPt.right),
      bottom: microns(box.paddingPt.bottom),
      left: microns(box.paddingPt.left),
    },
  }
}

/** CI 里没有 Electron 时的分页替身。生产宿主仍是 printToPDF，见 PrintHost。 */
export function paginateHtml(html: string, box: PageBox = readPageBox(html)): string[][] {
  const text = visibleText(html)
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const contentWidth = Math.max(40, box.widthPt - box.paddingPt.left - box.paddingPt.right)
  const contentHeight = Math.max(40, box.heightPt - box.paddingPt.top - box.paddingPt.bottom)
  const charsPerLine = Math.max(8, Math.floor(contentWidth / 6))
  const linesPerPage = Math.max(1, Math.floor(contentHeight / 14))
  const wrapped: string[] = []
  for (const line of lines) {
    const ascii = toWinAnsi(line)
    for (let i = 0; i < ascii.length; i += charsPerLine) wrapped.push(ascii.slice(i, i + charsPerLine))
  }
  if (wrapped.length === 0) wrapped.push('')
  const pages: string[][] = []
  for (let i = 0; i < wrapped.length; i += linesPerPage) pages.push(wrapped.slice(i, i + linesPerPage))
  return pages
}

export function htmlToPdf(html: string, box: PageBox = readPageBox(html)): Uint8Array {
  return textToPdf(paginateHtml(html, box), box.widthPt, box.heightPt)
}

export function textToPdf(pages: string[][], widthPt: number, heightPt: number): Uint8Array {
  const objects: string[] = []
  const pageIds: number[] = []
  const fontId = 3
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let next = 4
  for (const lines of pages) {
    const contentId = next++
    const pageId = next++
    pageIds.push(pageId)
    const commands = ['BT', '/F1 11 Tf', '14 TL', `${72} ${heightPt - 72} Td`]
    lines.forEach((line, index) => {
      if (index > 0) commands.push('T*')
      commands.push(`(${escapePdfText(line)}) Tj`)
    })
    commands.push('ET')
    const stream = commands.join('\n')
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
  }
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length
    body += `${id} 0 obj\n${objects[id] ?? '<< >>'}\nendobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(body)
}

export function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

export async function readPdfPages(bytes: Uint8Array): Promise<{ pageCount: number; texts: string[] }> {
  const runtime = globalThis as typeof globalThis & { pdfjsWorker?: unknown }
  runtime.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })
  try {
    const document = await task.promise
    const texts: string[] = []
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent()
      texts.push(content.items.map(item => ('str' in item ? item.str : '')).join(''))
    }
    return { pageCount: document.numPages, texts }
  } finally {
    await task.destroy()
  }
}

export function pageIsBlank(samples: ArrayLike<number>, channels = 1, varianceThreshold = 12): boolean {
  if (samples.length === 0) return true
  let count = 0
  let mean = 0
  for (let i = 0; i < samples.length; i += channels) {
    const luminance = channels === 1 ? samples[i]! : (0.2126 * samples[i]! + 0.7152 * (samples[i + 1] ?? 0) + 0.0722 * (samples[i + 2] ?? 0))
    count++
    mean += luminance
  }
  mean /= count
  let variance = 0
  for (let i = 0; i < samples.length; i += channels) {
    const luminance = channels === 1 ? samples[i]! : (0.2126 * samples[i]! + 0.7152 * (samples[i + 1] ?? 0) + 0.0722 * (samples[i + 2] ?? 0))
    variance += (luminance - mean) ** 2
  }
  return variance / count <= varianceThreshold
}

export type AnchorBox = { address: string; x: number; y: number; width: number; height: number }

export function cropRange(anchors: AnchorBox[], range: string): { x: number; y: number; width: number; height: number } | null {
  const match = /([A-Z]+)(\d+):([A-Z]+)(\d+)/i.exec(range.replace(/^[^!]*!/, ''))
  if (!match) return null
  const cells = expandAddresses(match[1]!, Number(match[2]), match[3]!, Number(match[4]))
  const boxes = anchors.filter(anchor => cells.has(anchor.address.toUpperCase()))
  if (boxes.length === 0) return null
  const x = Math.min(...boxes.map(box => box.x))
  const y = Math.min(...boxes.map(box => box.y))
  const right = Math.max(...boxes.map(box => box.x + box.width))
  const bottom = Math.max(...boxes.map(box => box.y + box.height))
  return { x, y, width: right - x, height: bottom - y }
}

function expandAddresses(col1: string, row1: number, col2: string, row2: number): Set<string> {
  const cells = new Set<string>()
  const startCol = columnIndex(col1)
  const endCol = columnIndex(col2)
  for (let row = Math.min(row1, row2); row <= Math.max(row1, row2); row++) {
    for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) cells.add(`${columnName(col)}${row}`)
  }
  return cells
}

function columnIndex(col: string): number {
  let n = 0
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function columnName(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function parsePadding(value: string): PageBox['paddingPt'] {
  const parts = value.trim().split(/\s+/).map(part => Number(part.replace(/pt$/, '')))
  const [a = 72, b = a, c = a, d = b] = parts
  if (parts.length === 1) return { top: a, right: a, bottom: a, left: a }
  if (parts.length === 2) return { top: a, right: b, bottom: a, left: b }
  if (parts.length === 3) return { top: a, right: b, bottom: c, left: b }
  return { top: a, right: b, bottom: c, left: d }
}

function toWinAnsi(text: string): string {
  let out = ''
  for (const ch of text) out += ch.charCodeAt(0) <= 255 ? ch : '?'
  return out
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}
