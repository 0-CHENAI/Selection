/**
 * OfficeCLI 1.0.157 的 Excel HTML 只认 `xdr:twoCellAnchor`。openpyxl 一类工具写的
 * `oneCellAnchor`（默认命名空间、无前缀）会被放到 A1、按 400×250pt 画，几张图叠在左上角，
 * 盖住指标。这里按工作簿里的锚点改写 HTML 浮动层的 data-from-row / data-from-col 和宽高，
 * 再由页面脚本按实际行列位置对齐。读不懂或个数对不上时原样返回，不猜。
 */
import { strFromU8, unzipSync } from 'fflate'

export interface XlsxFloatAnchor {
  col: number
  row: number
  /** 宽高，单位 pt；按 Excel 的列宽、行高从锚点算出，读不出时不给，保留 OfficeCLI 的估算 */
  widthPt?: number
  heightPt?: number
  /**
   * Excel 里图表覆盖的单元格范围，0 起的小数格坐标：整数部分是列 / 行号，小数部分是
   * 在那一格里的位置。twoCellAnchor 取 from / to；oneCellAnchor 按 ext 和列宽、行高推出 to。
   * 预览脚本按这几格在 HTML 里的实际位置摆图，所以图表盖住的格子与 Excel 一致。
   */
  range?: [fromX: number, fromY: number, toX: number, toY: number]
}

const EMU_PER_PT = 12700
const EMU_PER_PX = 9525
/** Excel 默认字体（Calibri / Carlito 11）的最大数字宽度，单位 px */
const MAX_DIGIT_PX = 7
const MAX_COLS = 16384
const MAX_ROWS = 1048576

interface SheetGeometry {
  colPx: (col: number) => number
  rowPt: (row: number) => number
}

/** 字符宽 → 像素，按 ECMA-376 18.3.1.13 的换算 */
const widthToPx = (width: number) => Math.max(0, Math.trunc(((256 * width + Math.trunc(128 / MAX_DIGIT_PX)) / 256) * MAX_DIGIT_PX))

function sheetGeometry(sheetXml: string): SheetGeometry {
  const format = /<(?:\w+:)?sheetFormatPr\b([^>]*)>/.exec(sheetXml)?.[1] ?? ''
  const attr = (source: string, name: string) => { const value = new RegExp(`\\b${name}="([^"]+)"`).exec(source)?.[1]; return value === undefined ? undefined : Number(value) }
  const baseWidth = attr(format, 'baseColWidth') ?? 8
  const defaultWidth = attr(format, 'defaultColWidth')
  const defaultColPx = defaultWidth !== undefined && Number.isFinite(defaultWidth) ? widthToPx(defaultWidth) : Math.trunc(baseWidth * MAX_DIGIT_PX + 5)
  const defaultRow = attr(format, 'defaultRowHeight')
  const defaultRowPt = defaultRow !== undefined && Number.isFinite(defaultRow) ? defaultRow : 15
  const cols = new Map<number, number>()
  for (const col of sheetXml.matchAll(/<(?:\w+:)?col\b([^>]*)\/?>/g)) {
    const min = attr(col[1]!, 'min'), max = attr(col[1]!, 'max'), width = attr(col[1]!, 'width')
    if (!min || !max || max < min || max - min > MAX_COLS) continue
    const hidden = /\bhidden="(?:1|true)"/.test(col[1]!)
    const px = hidden ? 0 : width !== undefined && Number.isFinite(width) ? widthToPx(width) : defaultColPx
    for (let c = min; c <= Math.min(max, MAX_COLS); c++) cols.set(c - 1, px)
  }
  const rows = new Map<number, number>()
  for (const row of sheetXml.matchAll(/<(?:\w+:)?row\b([^>]*)>/g)) {
    const r = attr(row[1]!, 'r')
    if (!r) continue
    const hidden = /\bhidden="(?:1|true)"/.test(row[1]!)
    const ht = attr(row[1]!, 'ht')
    rows.set(r - 1, hidden ? 0 : ht !== undefined && Number.isFinite(ht) ? ht : defaultRowPt)
  }
  return { colPx: col => cols.get(col) ?? defaultColPx, rowPt: row => rows.get(row) ?? defaultRowPt }
}

/** 从 (cell, offset EMU) 出发走 length EMU，返回终点的小数格坐标 */
function walk(start: number, offsetEmu: number, lengthEmu: number, sizeEmu: (index: number) => number, limit: number): number {
  let index = start, rest = offsetEmu + lengthEmu
  while (index < limit - 1 && rest > sizeEmu(index)) {
    rest -= sizeEmu(index)
    index++
  }
  const size = sizeEmu(index)
  return index + (size > 0 ? Math.min(1, rest / size) : 0)
}

const fraction = (index: number, offsetEmu: number, sizeEmu: (index: number) => number) => {
  const size = sizeEmu(index)
  return index + (size > 0 ? Math.min(1, Math.max(0, offsetEmu / size)) : 0)
}

/** 两个小数格坐标之间的长度（EMU） */
function span(from: number, to: number, sizeEmu: (index: number) => number): number {
  let total = 0
  for (let index = Math.floor(from); index <= Math.floor(to) && index < Math.floor(from) + MAX_COLS; index++) {
    const size = sizeEmu(index)
    const start = index === Math.floor(from) ? from - index : 0
    const end = index === Math.floor(to) ? to - index : 1
    total += Math.max(0, end - start) * size
  }
  return total
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece && piece !== '.') parts.push(piece)
  }
  return parts.join('/')
}

function relsOf(files: Record<string, Uint8Array>, part: string): Map<string, string> {
  const slash = part.lastIndexOf('/')
  const relsPath = `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`
  const map = new Map<string, string>()
  const xml = files[relsPath] ? strFromU8(files[relsPath]!) : ''
  for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[1]!)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(match[1]!)?.[1]
    if (id && target) map.set(id, resolvePart(part, target))
  }
  return map
}

/** 每个工作表（按 workbook.xml 顺序）的浮动对象锚点，顺序与绘图部件里的出现顺序一致 */
export function readXlsxFloatAnchors(bytes: Uint8Array): XlsxFloatAnchor[][] {
  const files = unzipSync(bytes, { filter: file => file.name.endsWith('.xml') || file.name.endsWith('.rels') })
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : ''
  const workbookRels = relsOf(files, 'xl/workbook.xml')
  const sheets: XlsxFloatAnchor[][] = []
  for (const sheet of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const rid = /\br:id="([^"]+)"/.exec(sheet[1]!)?.[1]
    const sheetPart = rid ? workbookRels.get(rid) : undefined
    const anchors: XlsxFloatAnchor[] = []
    const sheetXml = sheetPart && files[sheetPart] ? strFromU8(files[sheetPart]!) : ''
    const drawingId = /<(?:\w+:)?drawing\b[^>]*\br:id="([^"]+)"/.exec(sheetXml)?.[1]
    const drawingPart = drawingId && sheetPart ? relsOf(files, sheetPart).get(drawingId) : undefined
    const drawing = drawingPart && files[drawingPart] ? strFromU8(files[drawingPart]!) : ''
    const geometry = sheetXml ? sheetGeometry(sheetXml) : undefined
    const colEmu = (col: number) => (geometry?.colPx(col) ?? 64) * EMU_PER_PX
    const rowEmu = (row: number) => (geometry?.rowPt(row) ?? 15) * EMU_PER_PT
    for (const anchor of drawing.matchAll(/<(?:\w+:)?(oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[\s\S]*?<\/(?:\w+:)?\1>/g)) {
      const body = anchor[0]
      const marker = (name: 'from' | 'to') => {
        const xml = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`).exec(body)?.[1] ?? ''
        const read = (tag: string) => Number(new RegExp(`<(?:\\w+:)?${tag}>(-?\\d+)<`).exec(xml)?.[1] ?? NaN)
        return { col: read('col'), colOff: read('colOff'), row: read('row'), rowOff: read('rowOff') }
      }
      const from = marker('from')
      const { col, row } = from
      const ext = /<(?:\w+:)?ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(body.replace(/<a:ext\b[^>]*\/>/g, ''))
      if (anchor[1] === 'absoluteAnchor' || !Number.isFinite(col) || !Number.isFinite(row)) { anchors.push({ col: -1, row: -1 }); continue }
      const fromX = fraction(col, Number.isFinite(from.colOff) ? from.colOff : 0, colEmu)
      const fromY = fraction(row, Number.isFinite(from.rowOff) ? from.rowOff : 0, rowEmu)
      let range: XlsxFloatAnchor['range']
      if (anchor[1] === 'oneCellAnchor' && ext) {
        range = [fromX, fromY,
          walk(col, Number.isFinite(from.colOff) ? from.colOff : 0, Number(ext[1]), colEmu, MAX_COLS),
          walk(row, Number.isFinite(from.rowOff) ? from.rowOff : 0, Number(ext[2]), rowEmu, MAX_ROWS)]
      } else if (anchor[1] === 'twoCellAnchor') {
        const to = marker('to')
        if (Number.isFinite(to.col) && Number.isFinite(to.row) && (to.col > col || (to.col === col && to.colOff > from.colOff)) && (to.row > row || (to.row === row && to.rowOff > from.rowOff))) {
          range = [fromX, fromY, fraction(to.col, Number.isFinite(to.colOff) ? to.colOff : 0, colEmu), fraction(to.row, Number.isFinite(to.rowOff) ? to.rowOff : 0, rowEmu)]
        }
      }
      const round = (value: number) => Math.round(value * 10000) / 10000
      anchors.push({
        col, row,
        ...(anchor[1] === 'oneCellAnchor' && ext ? { widthPt: Number(ext[1]) / EMU_PER_PT, heightPt: Number(ext[2]) / EMU_PER_PT } : {}),
        ...(anchor[1] === 'twoCellAnchor' && range ? { widthPt: span(range[0], range[2], colEmu) / EMU_PER_PT, heightPt: span(range[1], range[3], rowEmu) / EMU_PER_PT } : {}),
        ...(range ? { range: range.map(round) as XlsxFloatAnchor['range'] } : {}),
      })
    }
    sheets.push(anchors)
  }
  return sheets
}

const FLOAT_DIV = /<div style="(position:absolute;[^"]*)" data-from-col="\d+" data-from-row="\d+"(?: data-anchor-range="[^"]*")?>/g

/** 按锚点改写 OfficeCLI Excel HTML 的浮动层。失败时原样返回。 */
export function alignXlsxFloats(html: string, bytes: Uint8Array): string {
  let sheets: XlsxFloatAnchor[][]
  try { sheets = readXlsxFloatAnchors(bytes) } catch { return html }
  const pieces = html.split(/(?=<div class="sheet-content\b)/)
  return pieces.map(piece => {
    const index = /^<div class="sheet-content\b[^>]*\bdata-sheet="(\d+)"/.exec(piece)?.[1]
    if (index === undefined) return piece
    const anchors = sheets[Number(index)] ?? []
    const count = piece.match(FLOAT_DIV)?.length ?? 0
    if (!count || count !== anchors.length) return piece
    let k = 0
    return piece.replace(FLOAT_DIV, (whole, style: string) => {
      const anchor = anchors[k++]!
      if (anchor.col < 0) return whole
      let next = style
      if (anchor.widthPt) next = next.replace(/width:[0-9.]+pt/, `width:${anchor.widthPt.toFixed(2)}pt`)
      if (anchor.heightPt) next = next.replace(/height:[0-9.]+pt/, `height:${anchor.heightPt.toFixed(2)}pt`)
      const range = anchor.range ? ` data-anchor-range="${anchor.range.join(' ')}"` : ''
      return `<div style="${next}" data-from-col="${anchor.col}" data-from-row="${anchor.row}"${range}>`
    })
  }).join('')
}
