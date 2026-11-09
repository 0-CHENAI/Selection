/**
 * 阶段 04 证明：把一份简单 PPTX 读成现行 version 1 的 deck.json，再用现有导出写回。
 * 未接入 CLI、技能和界面。LinNai 拍板前不要从 index.ts 导出，也不要在 SKILL.md 里调用。
 * 不移植 dsh 的演示引擎，也不使用那套工具前缀。复杂对象只登记诊断，不写入保留层（那是阶段 10）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { defaultLeading } from './metrics.ts'
import { parseDeckDocument } from './schema.ts'
import { parseImageContract } from './schema-v2-draft.ts'
import { DECK_FORMAT, DECK_VERSION, type Deck, type DeckElement, type DeckPage, type FontFace, type Theme } from './types.ts'

const EMU_PER_POINT = 12700
const MAX_BYTES = 8 * 1024 * 1024
const MAX_UNCOMPRESSED = 32 * 1024 * 1024
const MAX_SLIDES = 30
const MAX_NODES = 80

export const IMPORT_USER_MESSAGES = {
  smartart: '这是 SmartArt。当前不能改里面的文字和结构。请在源文件里拆成形状后再导入。',
  'embedded-object': '这里嵌着一个外部对象。工程里不能编辑它。',
  audio: '音频不会进入可编辑工程。',
  video: '视频不会进入可编辑工程。',
  emf: '这张图是 EMF 图元。不能改成可编辑图片。以后导出会把它留在原位，改版式时它不会跟着动。',
  wmf: '这张图是 WMF 图元。不能改成可编辑图片。以后导出会把它留在原位，改版式时它不会跟着动。',
  animation: '动画不会保留。',
  group: '这一组还没有拆开。组里的形状暂时不能单独改。',
  table: '表格还没有拆进工程。单元格暂时不能改。',
  chart: '图表还没有拆成可编辑数据。',
  hyperlink: '超链接没有写入工程。文字还在。',
  'custom-geometry': '自定义形状还没有转成路径。',
  'picture-crop': '图片裁剪还没有写入工程。阶段 10 会用 crop 字段保住裁剪。',
  retained: '这个对象按原位置保留，但不能在工程里改版式。改版式或换风格时它不会跟着动。',
} as const

export type ImportLevel = 'faithful' | 'approximate' | 'retained' | 'unsupported'

export type ImportDiagnostic = {
  level: ImportLevel
  slide?: number
  elementId?: string
  feature: string
  message: string
}

export type SimpleImportResult = {
  deck: Deck | null
  diagnostics: ImportDiagnostic[]
  assets: Record<string, Uint8Array>
  source: { fileName: string; sha256: string }
}

export type ImportSimplePptxOptions = {
  fileName?: string
  /** 只把图片写到调用方给出的目录。不传则不落盘。 */
  assetDir?: string
}

type XmlNode = { local: string; attrs: string; inner: string }

const PRESET_SHAPE: Record<string, 'rect' | 'roundRect' | 'ellipse' | 'line'> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  line: 'line',
  straightConnector1: 'line',
}

export function importSimplePptx(bytes: Uint8Array, options: ImportSimplePptxOptions = {}): SimpleImportResult {
  const fileName = options.fileName?.trim() || 'imported.pptx'
  const source = { fileName, sha256: createHash('sha256').update(bytes).digest('hex') }
  const diagnostics: ImportDiagnostic[] = []
  const assets: Record<string, Uint8Array> = {}
  const files = unzipPackage(bytes)
  const presentation = textOf(files, 'ppt/presentation.xml')
  if (!presentation) throw new Error('不是有效的 PPTX')
  rejectUnsafeXml(presentation)
  const size = tagAttrs(presentation, 'sldSz')
  const width = points(Number(attr(size, 'cx')))
  const height = points(Number(attr(size, 'cy')))
  if (width === null || height === null || width < 200 || height < 200 || width > 2000 || height > 2000) {
    diagnostics.push({ level: 'unsupported', feature: 'slide-size', message: '页面尺寸不在 deck.json 可接受的范围内，没有生成工程。' })
    return { deck: null, diagnostics, assets, source }
  }
  const scheme = readScheme(textOf(files, themePath(files)))
  const fonts = readFonts(textOf(files, themePath(files)))
  const theme = buildTheme(fileName, scheme, fonts, diagnostics)
  const slides = slideParts(files, presentation)
  if (slides.length === 0) throw new Error('PPTX 里没有页面')
  if (slides.length > MAX_SLIDES) throw new Error(`PPTX 超过本证明的页数上限（${MAX_SLIDES}）`)
  const pages: DeckPage[] = []
  slides.forEach((part, index) => {
    const page = importSlide(files, part, index + 1, theme, diagnostics, assets, options.assetDir)
    pages.push(page)
  })
  const candidate: Deck = {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title: titleFrom(fileName),
    canvas: { width, height },
    theme,
    pages,
  }
  const parsed = parseDeckDocument(candidate)
  if (!parsed.deck) {
    for (const issue of parsed.issues) diagnostics.push({ level: 'unsupported', feature: 'schema', message: issue.message, slide: undefined, elementId: issue.elementId })
    return { deck: null, diagnostics, assets, source }
  }
  return { deck: parsed.deck, diagnostics, assets, source }
}

function importSlide(files: Record<string, Uint8Array>, part: string, slide: number, theme: Theme, diagnostics: ImportDiagnostic[], assets: Record<string, Uint8Array>, assetDir?: string): DeckPage {
  const xml = textOf(files, part)
  rejectUnsafeXml(xml)
  const tree = firstLocal(xml, 'spTree')
  const background = backgroundOf(xml, theme, slide, diagnostics)
  const rels = readRels(textOf(files, relsPath(part)))
  if (rels.some(item => item.type.endsWith('/slideLayout'))) {
    diagnostics.push({ level: 'approximate', slide, feature: 'layout-inheritance', message: '母版和版式上的装饰没有并进本页。占位符只保留本页已经写上的文字和直接格式。' })
  }
  if (/<p:timing\b/.test(xml)) diagnostics.push({ level: 'unsupported', slide, feature: 'animation', message: IMPORT_USER_MESSAGES.animation })
  const notes = notesOf(files, part, rels)
  const contract = parseImageContract(notes)
  if (contract.status === 'invalid') diagnostics.push({ level: 'unsupported', slide, feature: 'image-slots', message: contract.message })
  const elements: DeckElement[] = []
  const used = new Set<string>()
  const nodes = tree ? topLevel(tree.inner).filter(node => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(node.local)).slice(0, MAX_NODES) : []
  if (tree && topLevel(tree.inner).filter(node => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(node.local)).length > MAX_NODES) {
    diagnostics.push({ level: 'unsupported', slide, feature: 'object-budget', message: `本页对象超过 ${MAX_NODES} 个，多出来的没有读。` })
  }
  for (const [index, node] of nodes.entries()) expandNode(node, slide, index + 1, files, part, rels, theme, elements, used, diagnostics, assets, assetDir)
  if (contract.status === 'ok') {
    const bound = parseImageContract(notes, elements.map(item => ({ id: item.id, type: item.type })))
    diagnostics.push(bound.status === 'ok'
      ? { level: 'faithful', slide, feature: 'image-slots', message: '本页备注里的图片槽合同已原样保留。页级字段要等 version 2 草案接入后再写。' }
      : { level: 'approximate', slide, feature: 'image-slots', message: bound.status === 'invalid' ? bound.message : '图片槽合同已保留在备注里。' })
  }
  const name = attr(tagAttrs(xml, 'cSld'), 'name')
  return { id: `p${slide}`, layout: 'free', name: name || undefined, background, elements, notes }
}

function expandNode(node: XmlNode, slide: number, index: number, files: Record<string, Uint8Array>, part: string, rels: Rel[], theme: Theme, elements: DeckElement[], used: Set<string>, diagnostics: ImportDiagnostic[], assets: Record<string, Uint8Array>, assetDir?: string): void {
  if (node.local === 'AlternateContent') {
    diagnostics.push({ level: 'approximate', slide, feature: 'alternate-content', message: '兼容分支已改读备用表示。' })
    const branch = topLevel(node.inner).find(item => item.local === 'Fallback') ?? topLevel(node.inner).find(item => item.local === 'Choice')
    if (!branch) return
    for (const [childIndex, child] of topLevel(branch.inner).entries()) expandNode(child, slide, index * 100 + childIndex, files, part, rels, theme, elements, used, diagnostics, assets, assetDir)
    return
  }
  if (node.local === 'grpSp') {
    diagnostics.push({ level: 'retained', slide, feature: 'group', elementId: shapeName(node), message: IMPORT_USER_MESSAGES.group })
    return
  }
  if (node.local === 'graphicFrame') {
    diagnoseFrame(node, slide, diagnostics)
    return
  }
  if (node.local === 'pic') {
    importPicture(node, slide, index, files, part, rels, elements, used, diagnostics, assets, assetDir)
    return
  }
  if (node.local === 'sp' || node.local === 'cxnSp') {
    importShape(node, slide, index, theme, elements, used, diagnostics)
    return
  }
  diagnostics.push({ level: 'unsupported', slide, feature: node.local || 'unknown', elementId: shapeName(node), message: IMPORT_USER_MESSAGES.retained })
}

function importShape(node: XmlNode, slide: number, index: number, theme: Theme, elements: DeckElement[], used: Set<string>, diagnostics: ImportDiagnostic[]): void {
  const bounds = boundsOf(node)
  const id = elementId(shapeName(node), slide, index, used)
  if (!bounds) {
    diagnostics.push({ level: 'unsupported', slide, elementId: id, feature: 'bounds', message: '这个对象没有可用的二维边界，没有写入工程。' })
    return
  }
  if (/<a:effectLst\b|<a:effectDag\b|<a:scene3d\b|<a:sp3d\b|<a:prstTxWarp\b/.test(node.inner)) {
    diagnostics.push({ level: 'approximate', slide, elementId: id, feature: 'effects', message: '阴影、发光和三维效果没有写入，几何仍按本页格式保留。' })
  }
  const placeholder = /<p:ph\b[^>]*>/.exec(node.inner)?.[0]
  if (placeholder) diagnostics.push({ level: 'approximate', slide, elementId: id, feature: 'placeholder', message: `占位符（${attr(placeholder, 'type') || 'body'}）的母版样式没有展开，文本按本页直接格式写入。` })
  const txBody = firstLocalIn(node, 'txBody')
  const text = txBody ? paragraphText(txBody.inner) : ''
  if (txBody && /<a:hlinkClick\b/.test(txBody.inner)) diagnostics.push({ level: 'approximate', slide, elementId: id, feature: 'hyperlink', message: IMPORT_USER_MESSAGES.hyperlink })
  if (txBody && /<a:buChar\b|<a:buAutoNum\b|<a:buFont\b/.test(txBody.inner)) diagnostics.push({ level: 'approximate', slide, elementId: id, feature: 'bullets', message: '项目符号没有写入正文。' })
  if (txBody && mixedRuns(txBody.inner)) diagnostics.push({ level: 'approximate', slide, elementId: id, feature: 'rich-text', message: '多个文字样式已收成第一段的样式。' })
  const preset = presetOf(node)
  const fillKind = fillKindOf(node)
  if (preset === 'custom') diagnostics.push({ level: 'retained', slide, elementId: id, feature: 'custom-geometry', message: IMPORT_USER_MESSAGES['custom-geometry'] })
  else if (preset && !PRESET_SHAPE[preset]) diagnostics.push({ level: 'retained', slide, elementId: id, feature: 'preset-shape', message: `预设形状「${preset}」还不能映射，没有单独写入工程。` })
  if (fillKind === 'gradient') diagnostics.push({ level: 'retained', slide, elementId: id, feature: 'gradient', message: '渐变还没有写入工程。' })
  if (fillKind === 'picture') diagnostics.push({ level: 'retained', slide, elementId: id, feature: 'picture-fill', message: '形状上的图片填充还没有写入工程。' })
  if (fillKind === 'pattern') diagnostics.push({ level: 'retained', slide, elementId: id, feature: 'pattern', message: '图案填充还没有写入工程。' })
  const mapped = preset ? PRESET_SHAPE[preset] : undefined
  if (!mapped || preset === 'custom') {
    if (text) elements.push(textElement(id, text, bounds, txBody?.inner ?? '', theme, diagnostics))
    return
  }
  const solid = fillKind === 'solid' ? paintOf(shapePaintXml(node), theme) : undefined
  const line = lineOf(node, theme, diagnostics)
  const shapeVisible = Boolean(solid || line || mapped === 'line')
  if (shapeVisible && !(text && !solid && mapped !== 'line')) {
    const shapeId = text ? elementId(`${id}-shape`, slide, index, used) : id
    const shape: DeckElement = { id: shapeId, type: 'shape', shape: mapped, bounds, role: mapped === 'line' ? 'rule' : 'panel' }
    if (solid) shape.fill = bindColor(solid, theme, diagnostics)
    if (line) shape.line = line
    const arrow = arrowOf(node)
    if (arrow === 'other') diagnostics.push({ level: 'approximate', slide, elementId: shapeId, feature: 'arrow', message: '箭头已记成线段，箭头样式没有写入。' })
    else if (arrow) shape.arrow = arrow
    if (mapped === 'roundRect') shape.radius = 8
    elements.push(shape)
  }
  if (text) elements.push(textElement(id, text, bounds, txBody?.inner ?? '', theme, diagnostics))
}

function importPicture(node: XmlNode, slide: number, index: number, files: Record<string, Uint8Array>, part: string, rels: Rel[], elements: DeckElement[], used: Set<string>, diagnostics: ImportDiagnostic[], assets: Record<string, Uint8Array>, assetDir?: string): void {
  const id = elementId(shapeName(node) || `picture-${index}`, slide, index, used)
  const bounds = boundsOf(node)
  if (!bounds) {
    diagnostics.push({ level: 'unsupported', slide, elementId: id, feature: 'bounds', message: '这张图片没有可用的边界，没有写入工程。' })
    return
  }
  const embed = attr(/<a:blip\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'r:embed')
  const rel = rels.find(item => item.id === embed)
  if (!rel || rel.external) {
    diagnostics.push({ level: 'unsupported', slide, elementId: id, feature: 'external-media', message: '外部图片没有写入工程。' })
    return
  }
  const target = resolveRel(part, rel.target)
  const kind = mediaKind(target, files)
  if (kind === 'emf' || kind === 'wmf') {
    diagnostics.push({ level: 'retained', slide, elementId: id, feature: kind, message: IMPORT_USER_MESSAGES[kind] })
    return
  }
  if (kind === 'audio' || kind === 'video') {
    diagnostics.push({ level: 'unsupported', slide, elementId: id, feature: kind, message: IMPORT_USER_MESSAGES[kind] })
    return
  }
  if (kind !== 'png' && kind !== 'jpeg') {
    diagnostics.push({ level: 'retained', slide, elementId: id, feature: 'picture', message: IMPORT_USER_MESSAGES.retained })
    return
  }
  if (/<a:srcRect\b/.test(node.inner)) diagnostics.push({ level: 'approximate', slide, elementId: id, feature: 'picture-crop', message: IMPORT_USER_MESSAGES['picture-crop'] })
  const bytes = target ? files[target] : undefined
  if (!bytes) {
    diagnostics.push({ level: 'unsupported', slide, elementId: id, feature: 'picture', message: '图片数据不在文件里，没有写入工程。' })
    return
  }
  const assetName = `slide${slide}-${id}.${kind === 'png' ? 'png' : 'jpg'}`
  assets[assetName] = bytes
  const src = assetDir ? writeAsset(assetDir, assetName, bytes) : assetName
  elements.push({ id, type: 'image', bounds, src, alt: shapeName(node) || '导入图片', fit: 'fill', role: 'content' })
}

function textElement(id: string, value: string, bounds: DeckElement['bounds'], txBody: string, theme: Theme, diagnostics: ImportDiagnostic[]): DeckElement {
  const size = fontSizeOf(txBody)
  const leading = leadingOf(txBody, size) ?? defaultLeading(size)
  const family = containsCjk(value) ? '$cjk' as const : '$latin' as const
  const color = paintOf(runPaintXml(txBody), theme) ?? theme.colors.ink
  const maxLines = Math.max(1, Math.floor((bounds.h + 0.5) / (size * leading)))
  const perLine = Math.max(1, Math.floor(bounds.w / size))
  const glyphs = Array.from(value.replaceAll('\n', '')).length
  const face = faceOf(txBody, theme)
  return {
    id,
    type: 'text',
    bounds,
    role: 'content',
    text: value,
    textCapacity: { maxChars: Math.max(glyphs, perLine * maxLines), maxLines },
    font: {
      family,
      size,
      weight: /\bb="(?:1|true)"/.test(txBody) ? 'bold' : 'regular',
      italic: /\bi="(?:1|true)"/.test(txBody) ? true : undefined,
      color: bindColor(color, theme, diagnostics),
      align: alignOf(txBody),
      valign: valignOf(txBody),
      leading,
      face,
    },
  }
}

function diagnoseFrame(node: XmlNode, slide: number, diagnostics: ImportDiagnostic[]): void {
  const uri = attr(/<a:graphicData\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'uri')
  const name = shapeName(node)
  if (uri.includes('diagram')) diagnostics.push({ level: 'unsupported', slide, elementId: name, feature: 'smartart', message: IMPORT_USER_MESSAGES.smartart })
  else if (uri.includes('ole')) diagnostics.push({ level: 'unsupported', slide, elementId: name, feature: 'embedded-object', message: IMPORT_USER_MESSAGES['embedded-object'] })
  else if (uri.includes('chart')) diagnostics.push({ level: 'retained', slide, elementId: name, feature: 'chart', message: IMPORT_USER_MESSAGES.chart })
  else if (uri.includes('table') || /<a:tbl\b/.test(node.inner)) diagnostics.push({ level: 'retained', slide, elementId: name, feature: 'table', message: IMPORT_USER_MESSAGES.table })
  else diagnostics.push({ level: 'unsupported', slide, elementId: name, feature: 'graphic', message: IMPORT_USER_MESSAGES.retained })
}

function buildTheme(fileName: string, scheme: Record<string, string>, fonts: { latin?: string; ea?: string }, diagnostics: ImportDiagnostic[]): Theme {
  const ink = scheme.dk1 ?? '#111111'
  const paper = scheme.lt1 ?? '#FFFFFF'
  const muted = scheme.dk2 ?? '#5C5A55'
  const accent = scheme.accent1 ?? '#C41628'
  const surface = scheme.lt2 ?? '#F5F3EE'
  if (!scheme.dk1) diagnostics.push({ level: 'approximate', feature: 'theme', message: '文件没有可用的主题色，已用中性回退色。换风格前需要换成一套 theme。' })
  if (fonts.latin || fonts.ea) diagnostics.push({ level: 'approximate', feature: 'theme-font', message: '主题字体已写到 mac、win、linux 三端，使用文件里的同一个字体名。' })
  const latin = fonts.latin || 'Arial'
  const ea = fonts.ea || 'Microsoft YaHei'
  return {
    id: 'import-poc',
    name: titleFrom(fileName),
    margin: 48,
    colors: { ink, paper, muted, accent, line: '#CBC8C0', surface, inverse: '#FFFFFF' },
    fonts: {
      cjk: { mac: ea, win: ea, linux: ea },
      latin: { mac: latin, win: latin, linux: latin },
    },
    type: {
      display: { min: 44, max: 84 },
      title: { min: 28, max: 36 },
      body: { min: 16, max: 22 },
      caption: { min: 11, max: 14 },
    },
    source: '由 PPTX 导入证明生成。配色来自文件主题或回退色，不是已发布模板。',
  }
}

function bindColor(hex: string, theme: Theme, diagnostics: ImportDiagnostic[], prefer?: 'paper'): string {
  const upper = hex.toUpperCase()
  if (prefer === 'paper' && theme.colors.paper.toUpperCase() === upper) return '$paper'
  for (const key of ['ink', 'accent', 'muted', 'line', 'paper', 'surface', 'inverse'] as const) {
    if (theme.colors[key]?.toUpperCase() === upper) return `$${key}`
  }
  if (!diagnostics.some(item => item.feature === 'direct-color')) {
    diagnostics.push({ level: 'approximate', feature: 'direct-color', message: '有颜色写成了直接色值。和主题相同的颜色才会收成 token；这些直接色在整套换风格时不会跟着变。' })
  }
  return upper.startsWith('#') ? upper : `#${upper}`
}

function backgroundOf(xml: string, theme: Theme, slide: number, diagnostics: ImportDiagnostic[]): string {
  const bg = firstLocal(xml, 'bg')
  if (!bg) return '$paper'
  if (/<a:blipFill\b/.test(bg.inner)) diagnostics.push({ level: 'retained', slide, feature: 'background-picture', message: '背景图片没有写入工程，本页改用主题纸色。' })
  if (/<a:tile\b/.test(bg.inner)) diagnostics.push({ level: 'approximate', slide, feature: 'background-tile', message: '平铺背景没有写入工程。' })
  const color = paintOf(bg.inner, theme)
  return color ? bindColor(color, theme, diagnostics, 'paper') : '$paper'
}

function notesOf(files: Record<string, Uint8Array>, part: string, rels: Rel[]): string | undefined {
  const rel = rels.find(item => item.type.endsWith('/notesSlide') && !item.external)
  if (!rel) return undefined
  const target = resolveRel(part, rel.target)
  if (!target) return undefined
  const xml = textOf(files, target)
  rejectUnsafeXml(xml)
  const bodies = topLevel(firstLocal(xml, 'spTree')?.inner ?? '').filter(node => node.local === 'sp' && /<p:ph\b[^>]*\btype="body"/.test(node.inner))
  const notes = bodies.map(node => paragraphText(firstLocalIn(node, 'txBody')?.inner ?? '')).filter(Boolean).join('\n')
  return notes || undefined
}

function unzipPackage(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('不是有效的 PPTX')
  if (bytes.byteLength > MAX_BYTES) throw new Error('PPTX 超过 8MB，超出本证明的范围')
  let files: Record<string, Uint8Array>
  try { files = unzipSync(bytes) } catch { throw new Error('不是有效的 PPTX') }
  let total = 0
  for (const [name, value] of Object.entries(files)) {
    if (name.split('/').includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('PPTX 路径无效')
    total += value.byteLength
  }
  if (total > MAX_UNCOMPRESSED) throw new Error('PPTX 解压后超过本证明的范围')
  return files
}

type Rel = { id: string; type: string; target: string; external: boolean }

function readRels(xml: string): Rel[] {
  if (!xml) return []
  rejectUnsafeXml(xml)
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(match => ({
    id: attr(match[0], 'Id') ?? '',
    type: attr(match[0], 'Type') ?? '',
    target: attr(match[0], 'Target') ?? '',
    external: attr(match[0], 'TargetMode') === 'External',
  })).filter(item => item.id && item.target)
}

function slideParts(files: Record<string, Uint8Array>, presentation: string): string[] {
  const rels = readRels(textOf(files, 'ppt/_rels/presentation.xml.rels'))
  const ids = [...presentation.matchAll(/<p:sldId\b[^>]*>/g)].map(match => attr(match[0], 'r:id')).filter((id): id is string => !!id)
  return ids.map(id => {
    const rel = rels.find(item => item.id === id)
    if (!rel || rel.external) throw new Error('PPTX 页面关系无效')
    const path = resolveRel('ppt/presentation.xml', rel.target)
    if (!path || !files[path]) throw new Error('PPTX 页面关系无效')
    return path
  })
}

function resolveRel(sourcePart: string, target: string): string | null {
  const raw = target.startsWith('/') ? target.slice(1) : joinPosix(sourcePart.split('/').slice(0, -1).join('/'), target)
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const path = parts.join('/')
  if (!path.startsWith('ppt/') || path.split('/').includes('..')) return null
  return path
}

function joinPosix(dir: string, target: string): string {
  return `${dir}/${target}`.replaceAll(/\/+/g, '/')
}

function themePath(files: Record<string, Uint8Array>): string {
  return Object.keys(files).find(name => /^ppt\/theme\/theme\d+\.xml$/.test(name)) ?? ''
}

function relsPath(part: string): string {
  const name = part.split('/').pop() ?? ''
  return `${part.split('/').slice(0, -1).join('/')}/_rels/${name}.rels`
}

function readScheme(xml: string): Record<string, string> {
  const map: Record<string, string> = {}
  if (!xml) return map
  for (const name of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) {
    const block = new RegExp(`<a:${name}\\b[^>]*>([\\s\\S]*?)</a:${name}>`).exec(xml)?.[1] ?? ''
    const color = paintOf(block, {})
    if (color) map[name] = color
  }
  return map
}

function readFonts(xml: string): { latin?: string; ea?: string } {
  if (!xml) return {}
  const minor = new RegExp('<a:minorFont\\b[^>]*>([\\s\\S]*?)</a:minorFont>').exec(xml)?.[1] ?? xml
  return { latin: concreteFace(attr(/<a:latin\b[^>]*>/.exec(minor)?.[0] ?? '', 'typeface')), ea: concreteFace(typeface(minor, 'Hans') || attr(/<a:ea\b[^>]*>/.exec(minor)?.[0] ?? '', 'typeface')) }
}

function typeface(xml: string, script: string): string | undefined {
  return attr(new RegExp(`<a:font\\b[^>]*\\bscript="${script}"[^>]*>`).exec(xml)?.[0] ?? '', 'typeface')
    ?? attr(new RegExp(`<a:font\\b[^>]*\\btypeface="[^"]*"[^>]*\\bscript="${script}"[^>]*>`).exec(xml)?.[0] ?? '', 'typeface')
}

function concreteFace(value: string | undefined): string | undefined {
  if (!value || value.startsWith('+') || value === ' ') return undefined
  return value
}

function faceOf(txBody: string, theme: Theme): FontFace | undefined {
  const latin = concreteFace(attr(/<a:latin\b[^>]*>/.exec(txBody)?.[0] ?? '', 'typeface')) ?? theme.fonts.latin.win
  const ea = concreteFace(attr(/<a:ea\b[^>]*>/.exec(txBody)?.[0] ?? '', 'typeface')) ?? theme.fonts.cjk.win
  if (!latin && !ea) return undefined
  const cjk = ea || latin
  const west = latin || ea
  return { latin: west, cjk: { mac: cjk, win: cjk, linux: cjk } }
}

function paintOf(xml: string, scheme: Record<string, string> | Theme): string | undefined {
  const colors = 'colors' in scheme ? scheme.colors : scheme
  const srgb = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(xml)
  if (srgb) return `#${srgb[1]!.toUpperCase()}`
  const schemeClr = /<a:schemeClr\b[^>]*\bval="([^"]+)"/.exec(xml)
  if (schemeClr) {
    const token = schemeClr[1]!
    const aliases: Record<string, string> = { dk1: 'ink', lt1: 'paper', dk2: 'muted', lt2: 'surface', accent1: 'accent' }
    const mapped = colors[aliases[token] ?? token] ?? colors[token]
    if (typeof mapped === 'string' && mapped.startsWith('#')) return mapped.toUpperCase()
  }
  const sys = /<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/.exec(xml)
  if (sys) return `#${sys[1]!.toUpperCase()}`
  return undefined
}

function shapePaintXml(node: XmlNode): string {
  const spPr = firstLocalIn(node, 'spPr')
  if (!spPr) return ''
  return spPr.inner.replace(/<a:ln\b[\s\S]*<\/a:ln>/, '')
}

function fillKindOf(node: XmlNode): 'none' | 'solid' | 'gradient' | 'picture' | 'pattern' {
  const xml = shapePaintXml(node)
  if (/<a:noFill\s*\/>/.test(xml)) return 'none'
  if (/<a:gradFill\b/.test(xml)) return 'gradient'
  if (/<a:blipFill\b/.test(xml)) return 'picture'
  if (/<a:pattFill\b/.test(xml)) return 'pattern'
  return /<a:srgbClr\b|<a:schemeClr\b|<a:sysClr\b/.test(xml) ? 'solid' : 'none'
}

function runPaintXml(txBody: string): string {
  return /<a:rPr\b[\s\S]*?<\/a:rPr>/.exec(txBody)?.[0] ?? txBody
}

function lineOf(node: XmlNode, theme: Theme, diagnostics: ImportDiagnostic[]): DeckElement['line'] | undefined {
  const ln = /<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>/.exec(firstLocalIn(node, 'spPr')?.inner ?? '')
  if (!ln) return undefined
  if (/<a:noFill\s*\/>/.test(ln[2] ?? '')) return undefined
  const color = paintOf(ln[2] ?? '', theme)
  if (!color) return undefined
  const widthEmu = Number(attr(ln[1] ?? '', 'w'))
  const width = Number.isFinite(widthEmu) && widthEmu > 0 ? Math.max(0.25, (points(widthEmu) ?? 1)) : 1
  return { color: bindColor(color, theme, diagnostics), width }
}

function arrowOf(node: XmlNode): 'start' | 'end' | 'both' | 'other' | undefined {
  const spPr = firstLocalIn(node, 'spPr')?.inner ?? ''
  const head = /<a:headEnd\b[^>]*\btype="([^"]+)"/.exec(spPr)?.[1]
  const tail = /<a:tailEnd\b[^>]*\btype="([^"]+)"/.exec(spPr)?.[1]
  const known = (value?: string) => !!value && value !== 'none' && ['triangle', 'stealth', 'arrow'].includes(value)
  const other = (value?: string) => !!value && value !== 'none' && !known(value)
  if (other(head) || other(tail)) return 'other'
  if (known(head) && known(tail)) return 'both'
  if (known(head)) return 'end'
  if (known(tail)) return 'start'
  return undefined
}

function presetOf(node: XmlNode): string | undefined {
  const spPr = firstLocalIn(node, 'spPr')
  if (!spPr) return node.local === 'cxnSp' ? 'straightConnector1' : undefined
  if (firstLocalIn(spPr, 'custGeom')) return 'custom'
  return attr(firstLocalIn(spPr, 'prstGeom')?.attrs ?? '', 'prst') ?? (node.local === 'cxnSp' ? 'straightConnector1' : undefined)
}

function boundsOf(node: XmlNode): DeckElement['bounds'] | null {
  const xfrm = firstLocalIn(firstLocalIn(node, 'spPr') ?? node, 'xfrm') ?? firstLocalIn(node, 'xfrm')
  if (!xfrm) return null
  const off = firstLocalIn(xfrm, 'off')
  const ext = firstLocalIn(xfrm, 'ext')
  const x = points(Number(attr(off?.attrs ?? '', 'x')))
  const y = points(Number(attr(off?.attrs ?? '', 'y')))
  const w = points(Number(attr(ext?.attrs ?? '', 'cx')))
  const h = points(Number(attr(ext?.attrs ?? '', 'cy')))
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

function fontSizeOf(txBody: string): number {
  const hundredths = Number(/<a:rPr\b[^>]*\bsz="(\d+)"/.exec(txBody)?.[1] ?? 1800)
  const size = hundredths / 100
  if (!Number.isFinite(size)) return 18
  return Math.min(240, Math.max(6, size))
}

function leadingOf(txBody: string, size: number): number | undefined {
  const pct = Number(/<a:spcPct\b[^>]*\bval="(\d+)"/.exec(txBody)?.[1])
  const pts = Number(/<a:spcPts\b[^>]*\bval="(\d+)"/.exec(txBody)?.[1])
  const value = Number.isFinite(pct) && pct > 0 ? pct / 100000 : Number.isFinite(pts) && pts > 0 && size > 0 ? (pts / 100) / size : undefined
  if (value === undefined) return undefined
  const rounded = Math.round(value * 100) / 100
  return rounded >= 0.9 && rounded <= 2 ? rounded : undefined
}

function alignOf(txBody: string): 'left' | 'center' | 'right' {
  const value = attr(/<a:pPr\b[^>]*>/.exec(txBody)?.[0] ?? '', 'algn')
  if (value === 'ctr') return 'center'
  if (value === 'r') return 'right'
  return 'left'
}

function valignOf(txBody: string): 'top' | 'middle' | 'bottom' {
  const value = attr(/<a:bodyPr\b[^>]*>/.exec(txBody)?.[0] ?? '', 'anchor')
  if (value === 'ctr') return 'middle'
  if (value === 'b') return 'bottom'
  return 'top'
}

function mixedRuns(txBody: string): boolean {
  const runs = [...txBody.matchAll(/<a:r\b[^>]*>([\s\S]*?)<\/a:r>/g)].map(match => match[1] ?? '')
  if (runs.length < 2) return false
  const signature = (run: string) => `${/sz="(\d+)"/.exec(run)?.[1] ?? ''}|${/\bb="([^"]+)"/.exec(run)?.[1] ?? ''}|${paintOf(run, {}) ?? ''}`
  return new Set(runs.map(signature)).size > 1
}

function paragraphText(txBody: string): string {
  const paragraphs = [...txBody.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(match => match[1] ?? '')
  const source = paragraphs.length > 0 ? paragraphs : [txBody]
  return source.map(paragraph => [...paragraph.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1] ?? '')).join('')).join('\n').trim()
}

function shapeName(node: XmlNode): string {
  return attr(/<p:cNvPr\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'name') ?? ''
}

function elementId(name: string, slide: number, index: number, used: Set<string>): string {
  const cleaned = name.trim().replace(/\s+/g, '-')
  const base = /^[\w\u4e00-\u9fff.-]{1,64}$/.test(cleaned) ? cleaned : `s${slide}-e${index}`
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function points(emu: number): number | null {
  if (!Number.isFinite(emu)) return null
  return Math.round((emu / EMU_PER_POINT) * 100) / 100
}

function writeAsset(dir: string, name: string, bytes: Uint8Array): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

function mediaKind(target: string | null, files: Record<string, Uint8Array>): string {
  const name = (target ?? '').toLowerCase()
  if (name.endsWith('.emf')) return 'emf'
  if (name.endsWith('.wmf')) return 'wmf'
  if (name.endsWith('.png')) return 'png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpeg'
  if (/\.(mp3|wav|m4a)$/.test(name)) return 'audio'
  if (/\.(mp4|mov|wmv)$/.test(name)) return 'video'
  const types = textOf(files, '[Content_Types].xml')
  const part = target ? `/${target}` : ''
  const content = new RegExp(`PartName="${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*ContentType="([^"]+)"`).exec(types)?.[1] ?? ''
  if (content.includes('emf')) return 'emf'
  if (content.includes('wmf')) return 'wmf'
  if (content.includes('png')) return 'png'
  if (content.includes('jpeg')) return 'jpeg'
  return 'other'
}

function titleFrom(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName
  const title = base.replace(/\.pptx$/i, '').trim()
  return title || '导入的演示文稿'
}

function textOf(files: Record<string, Uint8Array>, path: string): string {
  const bytes = files[path]
  if (!bytes) return ''
  return new TextDecoder('utf-8').decode(bytes)
}

function rejectUnsafeXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('PPTX 含有不受支持的 XML 声明')
}

function attr(source: string, name: string): string | undefined {
  if (!source) return undefined
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`).exec(source)?.[1]
}

function tagAttrs(xml: string, local: string): string {
  return firstLocal(xml, local)?.attrs ?? ''
}

function firstLocal(xml: string, local: string): XmlNode | null {
  const marker = new RegExp(`<(?:[A-Za-z0-9]+:)?${local}\\b`)
  const found = marker.exec(xml)
  if (!found || found.index === undefined) return null
  return readNode(xml, found.index)?.node ?? null
}

function firstLocalIn(node: XmlNode, local: string): XmlNode | undefined {
  return topLevel(node.inner).find(item => item.local === local)
}

function topLevel(inner: string): XmlNode[] {
  const nodes: XmlNode[] = []
  let index = 0
  while (index < inner.length) {
    const start = inner.indexOf('<', index)
    if (start < 0) break
    if (inner.startsWith('</', start) || inner.startsWith('<?', start) || inner.startsWith('<!', start)) {
      const end = inner.indexOf('>', start)
      index = end < 0 ? inner.length : end + 1
      continue
    }
    const read = readNode(inner, start)
    if (!read) break
    nodes.push(read.node)
    index = read.end
  }
  return nodes
}

function readNode(xml: string, start: number): { node: XmlNode; end: number } | null {
  if (xml[start] !== '<' || xml.startsWith('</', start)) return null
  const gt = xml.indexOf('>', start)
  if (gt < 0) return null
  let open = xml.slice(start + 1, gt).trim()
  const selfClosing = open.endsWith('/')
  if (selfClosing) open = open.slice(0, -1).trim()
  const name = /^([A-Za-z0-9:]+)/.exec(open)?.[1]
  if (!name) return null
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  const attrs = open.slice(name.length)
  if (selfClosing) return { node: { local, attrs, inner: '' }, end: gt + 1 }
  let depth = 1
  const token = /<(\/?)([A-Za-z0-9:]+)([^>]*)>/g
  token.lastIndex = gt + 1
  let match: RegExpExecArray | null
  while ((match = token.exec(xml))) {
    const closing = match[1] === '/'
    const self = !closing && /\/\s*$/.test(match[3] ?? '')
    if (self) continue
    depth += closing ? -1 : 1
    if (depth === 0) return { node: { local, attrs, inner: xml.slice(gt + 1, match.index) }, end: token.lastIndex }
  }
  return null
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (all, token: string) => {
    if (token === 'amp') return '&'
    if (token === 'lt') return '<'
    if (token === 'gt') return '>'
    if (token === 'quot') return '"'
    if (token === 'apos') return "'"
    if (token.startsWith('#x')) return String.fromCodePoint(Number.parseInt(token.slice(2), 16))
    if (token.startsWith('#')) return String.fromCodePoint(Number.parseInt(token.slice(1), 10))
    return all
  })
}
