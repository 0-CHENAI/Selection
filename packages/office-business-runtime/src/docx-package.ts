import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

export interface OutlineBlock {
  kind: 'heading' | 'table' | 'image'
  style?: string
  text?: string
  columns?: number
  count?: number
}

export interface DocParagraph {
  kind: 'p'
  text: string
  style?: 'Title' | 'Heading1' | 'Heading2'
  color?: string
  sizeHalfPoints?: number
  eastAsia?: string
  bold?: boolean
  align?: 'center' | 'left' | 'right'
  /** 右缩进，单位 twip。公文成文日期右空四字时用 */
  indentRight?: number
  /** 段后分隔线颜色，例如公文版头下的红色分隔线 */
  ruleBelow?: string
  /** 段前、段后间距，单位 twip */
  spaceBefore?: number
  spaceAfter?: number
  /** 首行缩进，单位 twip */
  indentFirstLine?: number
  /** 固定行距，单位 twip；公文正文 28 磅即 560 */
  lineExact?: number
  /** 与下段同页（Word「与下段同页」）。标题、末段正文接落款时用 */
  keepNext?: boolean
  /** 段中不分页（Word「段中不分页」） */
  keepLines?: boolean
}

export interface DocTable {
  kind: 'table'
  rows: string[][]
  /** 各列宽度，单位 twip；不给时每列 2400 */
  widths?: number[]
  /** grid：全框线；record：公文版记，只有上下粗线和行间细线 */
  borders?: 'grid' | 'record'
  /** 首行作表头：加粗、浅灰底 */
  header?: boolean
  /** 单元格内右对齐制表位，单位 twip。文本里的 \t 跳到这里 */
  rightTab?: number
  /** 浮动到所在页版心底部，例如公文版记置于末页下端（GB/T 9704 7.4） */
  anchorBottom?: boolean
}

export interface DocImage {
  kind: 'image'
  data: Uint8Array
  name: string
}

export type DocBlock = DocParagraph | DocTable | DocImage

export interface DocOptions {
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
}

/** Word 2013+ 的兼容性设置（与 OfficeCLI create 的默认值一致） */
export const WORD_COMPAT_SETTINGS = [
  ['compatibilityMode', '15'],
  ['overrideTableStyleFontSizeAndJustification', '1'],
  ['enableOpenTypeFeatures', '1'],
  ['doNotFlipMirrorIndents', '1'],
  ['differentiateMultirowTableHeaders', '1'],
].map(([name, value]) => `<w:compatSetting w:name="${name}" w:uri="http://schemas.microsoft.com/office/word" w:val="${value}"/>`).join('')

export const A4_PAGE = { width: 11906, height: 16838 } as const

/** GB/T 9704-2012 页边距，单位为 twip：上 37mm、下 35mm、左 28mm、右 26mm。 */
export const GBT_9704_MARGINS: DocOptions = {
  marginTop: 2098,
  marginRight: 1474,
  marginBottom: 1984,
  marginLeft: 1587,
}

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
  CRC_TABLE[index] = crc
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}

/** ZIP 存储法。DOCX 只需要可被 Word 打开的包，不依赖压缩库。 */
export function zipStore(entries: Array<{ name: string; data: Uint8Array }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.from(entry.data)
    const crc = crc32(data)
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ])
    locals.push(local)
    centrals.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]))
    offset += local.length
  }
  const central = Buffer.concat(centrals)
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return Buffer.concat([...locals, central, eocd])
}

export function unzip(buffer: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(buffer)
  let eocd = -1
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let index = buf.length - 22; index >= min; index -= 1) {
    if (buf.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('不是 ZIP 包')
  const count = buf.readUInt16LE(eocd + 10)
  let cursor = buf.readUInt32LE(eocd + 16)
  const files = new Map<string, Buffer>()
  for (let index = 0; index < count; index += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const method = buf.readUInt16LE(cursor + 10)
    const compressed = buf.readUInt32LE(cursor + 20)
    const nameLength = buf.readUInt16LE(cursor + 28)
    const extraLength = buf.readUInt16LE(cursor + 30)
    const commentLength = buf.readUInt16LE(cursor + 32)
    const localOffset = buf.readUInt32LE(cursor + 42)
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    const localName = buf.readUInt16LE(localOffset + 26)
    const localExtra = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localName + localExtra
    const payload = buf.subarray(start, start + compressed)
    const raw = method === 0 ? Buffer.from(payload) : inflateRawSync(payload)
    files.set(name, raw)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return files
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function runsXml(text: string, runProps: string): string {
  return text.split('\n').map((line, index) => {
    const parts = line.split('\t').map(part => `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join('<w:tab/>')
    return `<w:r>${runProps}${index ? '<w:br/>' : ''}${parts}</w:r>`
  }).join('')
}

function paragraphXml(block: DocParagraph): string {
  const style = block.style ? `<w:pStyle w:val="${block.style}"/>` : ''
  const rule = block.ruleBelow ? `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${block.ruleBelow}"/></w:pBdr>` : ''
  const spacing = block.spaceBefore !== undefined || block.spaceAfter !== undefined || block.lineExact
    ? `<w:spacing w:before="${block.spaceBefore ?? 0}" w:after="${block.spaceAfter ?? 0}"${block.lineExact ? ` w:line="${block.lineExact}" w:lineRule="exact"` : ''}/>`
    : ''
  const indent = block.indentRight || block.indentFirstLine
    ? `<w:ind${block.indentRight ? ` w:right="${block.indentRight}"` : ''}${block.indentFirstLine ? ` w:firstLine="${block.indentFirstLine}"` : ''}/>`
    : ''
  const align = block.align === 'center' || block.align === 'right' ? `<w:jc w:val="${block.align}"/>` : ''
  const fonts = block.eastAsia
    ? `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${escapeXml(block.eastAsia)}"/>`
    : ''
  const size = block.sizeHalfPoints
    ? `<w:sz w:val="${block.sizeHalfPoints}"/><w:szCs w:val="${block.sizeHalfPoints}"/>`
    : ''
  const color = block.color ? `<w:color w:val="${block.color}"/>` : ''
  const bold = block.bold ? '<w:b/>' : ''
  const runProps = fonts || size || color || bold ? `<w:rPr>${fonts}${bold}${color}${size}</w:rPr>` : ''
  const keep = `${block.keepNext ? '<w:keepNext/>' : ''}${block.keepLines ? '<w:keepLines/>' : ''}`
  return `<w:p><w:pPr>${style}${keep}${rule}${spacing}${indent}${align}</w:pPr>${runsXml(block.text, runProps)}</w:p>`
}

const CELL_SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'

function tableXml(block: DocTable): string {
  const columns = block.rows[0]?.length ?? 1
  const widths = Array.from({ length: columns }, (_, index) => block.widths?.[index] ?? 2400)
  const grid = widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')
  const line = (side: string, size: number) => `<w:${side} w:val="single" w:sz="${size}" w:space="0" w:color="000000"/>`
  const borders = block.borders === 'grid'
    ? `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => line(side, 4)).join('')}</w:tblBorders>`
    : block.borders === 'record'
      ? `<w:tblBorders>${line('top', 8)}${line('bottom', 8)}${line('insideH', 4)}</w:tblBorders>`
      : ''
  const floating = block.anchorBottom
    ? '<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:vertAnchor="margin" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpYSpec="bottom"/><w:tblOverlap w:val="never"/>'
    : ''
  const tblPr = block.widths || block.borders || floating
    ? `<w:tblPr>${floating}<w:tblW w:w="${widths.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    : ''
  const tabs = block.rightTab ? `<w:tabs><w:tab w:val="right" w:pos="${block.rightTab}"/></w:tabs>` : ''
  const rows = block.rows.map((row, rowIndex) => {
    const head = block.header && rowIndex === 0
    const cells = row.map((cell, column) => {
      const tcPr = block.widths || head
        ? `<w:tcPr><w:tcW w:w="${widths[column]}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEFF2"/>' : ''}</w:tcPr>`
        : ''
      // 单元格段落不继承正文段后距：行高只由文字和单元格边距决定，Word 与其他渲染器分页一致
      const paragraphs = cell.split('\n').map(text => `<w:p><w:pPr>${tabs}${CELL_SPACING}</w:pPr>${runsXml(text, head ? '<w:rPr><w:b/></w:rPr>' : '')}</w:p>`).join('')
      return `<w:tc>${tcPr}${paragraphs}</w:tc>`
    }).join('')
    return `<w:tr>${block.header && rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`
  }).join('')
  return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`
}

function imageXml(relId: string, name: string, docId: number): string {
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="3200400" cy="1800000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docId}" name="${escapeXml(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3200400" cy="1800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

export function buildDocx(blocks: readonly DocBlock[], options: DocOptions): Buffer {
  const body: string[] = []
  const media: Array<{ name: string; data: Uint8Array }> = []
  const rels: string[] = []
  let imageCount = 0
  for (const block of blocks) {
    if (block.kind === 'p') body.push(paragraphXml(block))
    else if (block.kind === 'table') body.push(tableXml(block))
    else {
      imageCount += 1
      const relId = `rId${imageCount}`
      const fileName = `image${imageCount}.png`
      media.push({ name: fileName, data: block.data })
      rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`)
      body.push(imageXml(relId, block.name || fileName, imageCount))
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${A4_PAGE.width}" w:h="${A4_PAGE.height}"/><w:pgMar w:top="${options.marginTop}" w:right="${options.marginRight}" w:bottom="${options.marginBottom}" w:left="${options.marginLeft}" w:header="850" w:footer="850" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/></w:pPr><w:rPr><w:sz w:val="44"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="120" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`
  // compatibilityMode 15：Word 2013 及以后的版式。缺少 settings 部件时 Word 按旧版本打开并在标题栏显示「兼容性模式」
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat>${WORD_COMPAT_SETTINGS}</w:compat></w:settings>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  ${rels.join('')}
</Relationships>`
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Selection</dc:creator></cp:coreProperties>`
  const entries: Array<{ name: string; data: Uint8Array }> = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'docProps/core.xml', data: Buffer.from(core) },
    { name: 'word/document.xml', data: Buffer.from(document) },
    { name: 'word/styles.xml', data: Buffer.from(styles) },
    { name: 'word/settings.xml', data: Buffer.from(settings) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(documentRels) },
  ]
  for (const item of media) entries.push({ name: `word/media/${item.name}`, data: item.data })
  return zipStore(entries)
}

export function documentXml(buffer: Uint8Array): string {
  const files = unzip(buffer)
  const xml = files.get('word/document.xml')
  if (!xml) throw new Error('DOCX 缺少 word/document.xml')
  return xml.toString('utf8')
}

export function readOutline(buffer: Uint8Array): OutlineBlock[] {
  const xml = documentXml(buffer)
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1]
  if (!body) throw new Error('DOCX 缺少正文')
  const blocks: OutlineBlock[] = []
  const pattern = /<w:p[\s>][\s\S]*?<\/w:p>|<w:tbl[\s>][\s\S]*?<\/w:tbl>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body))) {
    const chunk = match[0]
    if (chunk.startsWith('<w:tbl')) {
      blocks.push({ kind: 'table', columns: (chunk.match(/<w:gridCol\b/g) ?? []).length })
      continue
    }
    const style = /<w:pStyle w:val="([^"]+)"/.exec(chunk)?.[1] ?? ''
    const text = [...chunk.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map(item => item[1] ?? '')
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
    if (style === 'Title' || style === 'Heading1' || style === 'Heading2') {
      blocks.push({ kind: 'heading', style, text })
    }
    const images = (chunk.match(/<a:blip\b/g) ?? []).length
    if (images) blocks.push({ kind: 'image', count: images })
  }
  return blocks
}

export function readMargins(buffer: Uint8Array): DocOptions | null {
  const xml = documentXml(buffer)
  const top = /<w:pgMar[^>]*w:top="(\d+)"/.exec(xml)?.[1]
  const right = /<w:pgMar[^>]*w:right="(\d+)"/.exec(xml)?.[1]
  const bottom = /<w:pgMar[^>]*w:bottom="(\d+)"/.exec(xml)?.[1]
  const left = /<w:pgMar[^>]*w:left="(\d+)"/.exec(xml)?.[1]
  if (!top || !right || !bottom || !left) return null
  return {
    marginTop: Number(top),
    marginRight: Number(right),
    marginBottom: Number(bottom),
    marginLeft: Number(left),
  }
}

export function plainText(buffer: Uint8Array): string {
  const xml = documentXml(buffer)
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map(item => item[1] ?? '')
    .join('\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export function mediaDigests(buffer: Uint8Array): string[] {
  const files = unzip(buffer)
  const names = [...files.keys()].filter(name => name.startsWith('word/media/')).sort()
  return names.map(name => sha256(files.get(name)!))
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
