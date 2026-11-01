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
  /** 宽高，单位 pt；twoCellAnchor 不给，保留 OfficeCLI 的估算 */
  widthPt?: number
  heightPt?: number
}

const EMU_PER_PT = 12700

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
    for (const anchor of drawing.matchAll(/<(?:\w+:)?(oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[\s\S]*?<\/(?:\w+:)?\1>/g)) {
      const body = anchor[0]
      const from = /<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/.exec(body)?.[1] ?? ''
      const col = Number(/<(?:\w+:)?col>(\d+)</.exec(from)?.[1] ?? NaN)
      const row = Number(/<(?:\w+:)?row>(\d+)</.exec(from)?.[1] ?? NaN)
      const ext = /<(?:\w+:)?ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(body.replace(/<a:ext\b[^>]*\/>/g, ''))
      if (anchor[1] === 'absoluteAnchor' || !Number.isFinite(col) || !Number.isFinite(row)) { anchors.push({ col: -1, row: -1 }); continue }
      anchors.push({
        col, row,
        ...(anchor[1] === 'oneCellAnchor' && ext ? { widthPt: Number(ext[1]) / EMU_PER_PT, heightPt: Number(ext[2]) / EMU_PER_PT } : {}),
      })
    }
    sheets.push(anchors)
  }
  return sheets
}

const FLOAT_DIV = /<div style="(position:absolute;[^"]*)" data-from-col="\d+" data-from-row="\d+">/g

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
      return `<div style="${next}" data-from-col="${anchor.col}" data-from-row="${anchor.row}">`
    })
  }).join('')
}
