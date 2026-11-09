/**
 * 阶段 10：外来 PPTX → deck.json。
 * deck.json 是唯一工程真相。写不进 schema 的对象走路线 B，标成 retained，导出时按原位置贴回。
 * 不移植演示引擎，不使用 pptd 前缀。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultLeading } from '../metrics.ts'
import { IMPORT_USER_MESSAGES } from '../pptx-import-poc.ts'
import { parseDeckDocument } from '../schema.ts'
import { parseImageContract } from '../schema-v2-draft.ts'
import {
  DECK_FORMAT,
  type Bounds,
  type ChartSpec,
  type Deck,
  type DeckElement,
  type DeckPage,
  type FontFace,
  type GradientFill,
  type PatternFill,
  type ShadowSpec,
  type Theme,
} from '../types.ts'
import {
  IMPORT_LIMITS,
  type Rel,
  type XmlNode,
  attr,
  decodeXml,
  firstLocal,
  firstLocalIn,
  points,
  readRels,
  rejectUnsafeXml,
  relsPath,
  resolveRel,
  slideParts,
  textOf,
  themePath,
  topLevel,
  unzipPackage,
} from './ooxml.ts'
import { emptyManifest, type RetainedFragment, type RetainedManifest, type RetainedMedia } from './retained.ts'

export const DSH_PAGE_OBJECT_CATEGORIES = ['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame', 'contentPart'] as const
export type SourceKind = (typeof DSH_PAGE_OBJECT_CATEGORIES)[number]
export type ImportLevel = 'faithful' | 'approximate' | 'retained' | 'unsupported'

export type ImportDiagnostic = {
  level: ImportLevel
  slide?: number
  elementId?: string
  feature: string
  message: string
  sourceKind?: SourceKind
}

export type ImportPptxOptions = {
  fileName?: string
  assetDir?: string
  maxSlides?: number
  maxBytes?: number
  maxUncompressed?: number
  maxEntries?: number
  maxNodes?: number
  deadlineMs?: number
  signal?: AbortSignal
}

export type ImportPptxResult = {
  deck: Deck | null
  diagnostics: ImportDiagnostic[]
  assets: Record<string, Uint8Array>
  retained: RetainedManifest
  source: { kind: 'import'; fileName: string; sha256: string }
}

const PRESET_SHAPE: Record<string, 'rect' | 'roundRect' | 'ellipse' | 'line'> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  line: 'line',
  straightConnector1: 'line',
}

const SKIP_PLACEHOLDER = new Set(['title', 'ctrTitle', 'subTitle', 'body', 'pic'])

type Frame = { ox: number; oy: number; sx: number; sy: number; chx: number; chy: number }

type SlideState = {
  files: Record<string, Uint8Array>
  part: string
  rels: Rel[]
  slide: number
  theme: Theme
  diagnostics: ImportDiagnostic[]
  assets: Record<string, Uint8Array>
  assetDir?: string
  elements: DeckElement[]
  used: Set<string>
  fragments: RetainedFragment[]
  frame: Frame | null
  decoration: boolean
  idPrefix: string
  maxNodes: number
}

export function importPptx(bytes: Uint8Array, options: ImportPptxOptions = {}): ImportPptxResult {
  const started = Date.now()
  const fileName = options.fileName?.trim() || 'imported.pptx'
  const source = { kind: 'import' as const, fileName, sha256: createHash('sha256').update(bytes).digest('hex') }
  const diagnostics: ImportDiagnostic[] = []
  const assets: Record<string, Uint8Array> = {}
  const retained = emptyManifest()
  const files = unzipPackage(bytes, options)
  const presentation = textOf(files, 'ppt/presentation.xml')
  if (!presentation) throw new Error('不是有效的 PPTX')
  rejectUnsafeXml(presentation)
  const size = attrBlock(presentation, 'sldSz')
  const width = points(Number(attr(size, 'cx')))
  const height = points(Number(attr(size, 'cy')))
  if (width === null || height === null || width < 200 || height < 200 || width > 2000 || height > 2000) {
    diagnostics.push({ level: 'unsupported', feature: 'slide-size', message: '页面尺寸不在 deck.json 可接受的范围内，没有生成工程。' })
    return { deck: null, diagnostics, assets, retained, source }
  }
  const themeXml = textOf(files, themePath(files))
  const scheme = readScheme(themeXml)
  const fonts = readFonts(themeXml)
  const theme = buildTheme(fileName, scheme, fonts, diagnostics)
  const slides = slideParts(files, presentation)
  if (slides.length === 0) throw new Error('PPTX 里没有页面')
  const maxSlides = options.maxSlides ?? IMPORT_LIMITS.maxSlides
  if (slides.length > maxSlides) throw new Error(`PPTX 超过页数上限（${maxSlides}）`)
  const pages: DeckPage[] = []
  for (const [index, part] of slides.entries()) {
    if (options.signal?.aborted) throw new Error('导入已取消')
    if (options.deadlineMs !== undefined && Date.now() - started > options.deadlineMs) throw new Error('导入超时')
    const page = importSlide(files, part, index + 1, theme, diagnostics, assets, retained, options)
    pages.push(page)
  }
  const candidate: Deck = {
    format: DECK_FORMAT,
    version: 2,
    source,
    title: titleFrom(fileName),
    canvas: { width, height },
    theme,
    pages,
  }
  const parsed = parseDeckDocument(candidate)
  if (!parsed.deck) {
    for (const item of parsed.issues) diagnostics.push({ level: 'unsupported', feature: 'schema', message: item.message, elementId: item.elementId })
    return { deck: null, diagnostics, assets, retained, source }
  }
  return { deck: parsed.deck, diagnostics, assets, retained, source }
}

export function coverageReport(diagnostics: ImportDiagnostic[]): { counts: Record<ImportLevel, number>; rows: ImportDiagnostic[] } {
  const counts: Record<ImportLevel, number> = { faithful: 0, approximate: 0, retained: 0, unsupported: 0 }
  for (const item of diagnostics) counts[item.level] += 1
  return { counts, rows: diagnostics }
}

function importSlide(files: Record<string, Uint8Array>, part: string, slide: number, theme: Theme, diagnostics: ImportDiagnostic[], assets: Record<string, Uint8Array>, retained: RetainedManifest, options: ImportPptxOptions): DeckPage {
  const xml = textOf(files, part)
  rejectUnsafeXml(xml)
  const rels = readRels(textOf(files, relsPath(part)))
  const state = blankState(files, part, rels, slide, theme, diagnostics, assets, options)
  const inherited = inheritedNodes(state)
  const tree = firstLocal(xml, 'spTree')
  const nodes = visualNodes(tree?.inner ?? '').slice(0, state.maxNodes)
  if (visualNodes(tree?.inner ?? '').length > state.maxNodes) {
    diagnostics.push({ level: 'unsupported', slide, feature: 'object-budget', message: `本页对象超过 ${state.maxNodes} 个，多出来的没有读。` })
  }
  for (const [index, node] of nodes.entries()) expandNode(state, node, index + 1)
  const background = backgroundOf(state, xml)
  if (/<p:timing\b/.test(xml)) diagnostics.push({ level: 'unsupported', slide, feature: 'animation', message: IMPORT_USER_MESSAGES.animation, sourceKind: 'sp' })
  if (/<p:transition\b/.test(xml)) diagnostics.push({ level: 'unsupported', slide, feature: 'transition', message: '切换不会保留。' })
  const notes = notesOf(files, part, rels)
  const page: DeckPage = {
    id: `p${slide}`,
    layout: 'free',
    name: attr(attrBlock(xml, 'cSld'), 'name') || undefined,
    background: background.color,
    elements: [...inherited.elements, ...state.elements],
    notes,
    layoutRef: inherited.layoutRef,
  }
  const contract = parseImageContract(notes, page.elements.map(item => ({ id: item.id, type: item.type })))
  if (contract.status === 'ok') page.imageSlots = contract.contract
  if (contract.status === 'invalid') diagnostics.push({ level: 'unsupported', slide, feature: 'image-slots', message: contract.message })
  if (contract.status === 'ok') diagnostics.push({ level: 'faithful', slide, feature: 'image-slots', message: '备注里的图片槽合同已复制到页级 imageSlots，备注原文仍保留。' })
  retained.slides.push({ pageId: page.id, backgroundXml: background.retainedXml, fragments: state.fragments })
  return page
}

function blankState(files: Record<string, Uint8Array>, part: string, rels: Rel[], slide: number, theme: Theme, diagnostics: ImportDiagnostic[], assets: Record<string, Uint8Array>, options: ImportPptxOptions): SlideState {
  return {
    files, part, rels, slide, theme, diagnostics, assets,
    assetDir: options.assetDir,
    elements: [],
    used: new Set<string>(),
    fragments: [],
    frame: null,
    decoration: false,
    idPrefix: '',
    maxNodes: options.maxNodes ?? IMPORT_LIMITS.maxNodes,
  }
}

function inheritedNodes(state: SlideState): { elements: DeckElement[]; layoutRef?: DeckPage['layoutRef'] } {
  const layoutRel = state.rels.find(item => item.type.endsWith('/slideLayout') && !item.external)
  if (!layoutRel) return { elements: [] }
  const layoutPart = resolveRel(state.part, layoutRel.target)
  if (!layoutPart) return { elements: [] }
  state.diagnostics.push({
    level: 'approximate',
    slide: state.slide,
    feature: 'layout-inheritance',
    message: '母版和版式上的装饰已抄进本页，之后不再跟着母版更新。占位符正文仍只用本页直接格式。',
  })
  const layoutXml = textOf(state.files, layoutPart)
  rejectUnsafeXml(layoutXml)
  const layoutRels = readRels(textOf(state.files, relsPath(layoutPart)))
  const masterRel = layoutRels.find(item => item.type.endsWith('/slideMaster') && !item.external)
  const masterPart = masterRel ? resolveRel(layoutPart, masterRel.target) : null
  const elements: DeckElement[] = []
  if (masterPart) elements.push(...copyDecorations(state, masterPart, 'm-'))
  elements.push(...copyDecorations(state, layoutPart, 'l-', layoutXml, layoutRels))
  return {
    elements,
    layoutRef: {
      master: masterPart ? attr(attrBlock(textOf(state.files, masterPart), 'cSld'), 'name') : undefined,
      layout: attr(attrBlock(layoutXml, 'cSld'), 'name') || undefined,
    },
  }
}

function copyDecorations(state: SlideState, part: string, prefix: string, xml = textOf(state.files, part), rels = readRels(textOf(state.files, relsPath(part)))): DeckElement[] {
  rejectUnsafeXml(xml)
  const child: SlideState = { ...state, part, rels, elements: [], used: new Set(state.used), fragments: state.fragments, decoration: true, idPrefix: prefix, frame: null }
  const nodes = visualNodes(firstLocal(xml, 'spTree')?.inner ?? '')
  nodes.forEach((node, index) => expandNode(child, node, index + 1))
  for (const id of child.used) state.used.add(id)
  return child.elements.map(element => ({ ...element, role: 'decoration' as const }))
}

function expandNode(state: SlideState, node: XmlNode, index: number): void {
  if (node.local === 'AlternateContent') {
    state.diagnostics.push({ level: 'approximate', slide: state.slide, feature: 'alternate-content', message: '兼容分支已改读备用表示。' })
    const branch = topLevel(node.inner).find(item => item.local === 'Fallback') ?? topLevel(node.inner).find(item => item.local === 'Choice')
    if (!branch) return
    topLevel(branch.inner).forEach((child, childIndex) => expandNode(state, child, index * 100 + childIndex))
    return
  }
  const sourceKind = sourceKindOf(node.local)
  if (state.decoration && skippedPlaceholder(node)) return
  if (node.local === 'grpSp') {
    importGroup(state, node, index, sourceKind)
    return
  }
  if (node.local === 'graphicFrame') {
    importFrame(state, node, index, sourceKind)
    return
  }
  if (node.local === 'pic') {
    importPicture(state, node, index, sourceKind)
    return
  }
  if (node.local === 'sp' || node.local === 'cxnSp') {
    importShape(state, node, index, sourceKind)
    return
  }
  if (node.local === 'contentPart') {
    retain(state, node, index, 'content-part', IMPORT_USER_MESSAGES.retained, sourceKind ?? 'contentPart')
    return
  }
  state.diagnostics.push({ level: 'unsupported', slide: state.slide, feature: node.local || 'unknown', elementId: shapeName(node), message: IMPORT_USER_MESSAGES.retained, sourceKind })
}

function importGroup(state: SlideState, node: XmlNode, index: number, sourceKind?: SourceKind): void {
  const id = elementId(state, shapeName(node) || `group-${index}`, index)
  const children = visualNodes(node.inner)
  const frame = compose(state.frame, groupFrame(node))
  if (children.length === 0 || !frame) {
    retain(state, node, index, 'group', IMPORT_USER_MESSAGES.group, sourceKind, id)
    return
  }
  const before = state.elements.length
  const child: SlideState = { ...state, frame }
  children.forEach((item, childIndex) => expandNode(child, item, index * 100 + childIndex))
  const added = state.elements.slice(before)
  if (added.length === 0) {
    retain(state, node, index, 'group', IMPORT_USER_MESSAGES.group, sourceKind, id)
    return
  }
  for (const element of added) element.group = { id }
  state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'group', sourceKind, message: '组合已拆开。子形状可以单独改，group 字段仍记下原来的组。' })
}

function importFrame(state: SlideState, node: XmlNode, index: number, sourceKind?: SourceKind): void {
  const uri = attr(/<a:graphicData\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'uri') ?? ''
  if (uri.includes('diagram')) {
    state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: shapeName(node), feature: 'smartart', sourceKind, message: IMPORT_USER_MESSAGES.smartart })
    return
  }
  if (uri.includes('ole')) {
    state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: shapeName(node), feature: 'embedded-object', sourceKind, message: IMPORT_USER_MESSAGES['embedded-object'] })
    return
  }
  if (uri.includes('table') || /<a:tbl\b/.test(node.inner)) {
    const table = tableOf(state, node)
    if (table === 'merged') {
      retain(state, node, index, 'table-merge', '表格含有合并单元格，按原位置保留，单元格不能在工程里改。', sourceKind)
      return
    }
    if (table) {
      state.elements.push(table)
      state.diagnostics.push({ level: 'faithful', slide: state.slide, elementId: table.id, feature: 'table', sourceKind, message: '规则表格已拆成可编辑单元格。' })
      return
    }
    retain(state, node, index, 'table', IMPORT_USER_MESSAGES.table, sourceKind)
    return
  }
  if (uri.includes('chart')) {
    const chart = chartOf(state, node)
    if (chart) {
      state.elements.push(chart)
      state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: chart.id, feature: 'chart', sourceKind, message: '图表已按缓存数据重建。样式收进主题，不保留原图表的全部装饰。' })
      return
    }
    retain(state, node, index, 'chart', IMPORT_USER_MESSAGES.chart, sourceKind)
    return
  }
  state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: shapeName(node), feature: 'graphic', sourceKind, message: IMPORT_USER_MESSAGES.retained })
}

function importShape(state: SlideState, node: XmlNode, index: number, sourceKind?: SourceKind): void {
  const rawBounds = boundsOf(node)
  const bounds = rawBounds ? place(rawBounds, state.frame) : null
  const id = elementId(state, shapeName(node) || `shape-${index}`, index)
  if (!bounds) {
    state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: id, feature: 'bounds', sourceKind, message: '这个对象没有可用的二维边界，没有写入工程。' })
    return
  }
  noteEffects(state, node, id)
  const placeholder = /<p:ph\b[^>]*>/.exec(node.inner)?.[0]
  if (placeholder && !state.decoration) {
    state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'placeholder', sourceKind, message: `占位符（${attr(placeholder, 'type') || 'body'}）的母版样式没有展开，文本按本页直接格式写入。` })
  }
  const txBody = firstLocalIn(node, 'txBody')
  const text = txBody ? readText(state, txBody.inner, id) : undefined
  const preset = presetOf(node)
  const fillKind = fillKindOf(node)
  if (preset === 'custom') {
    const path = pathFromGeom(node, bounds)
    if (!path) {
      retain(state, node, index, 'custom-geometry', IMPORT_USER_MESSAGES['custom-geometry'], sourceKind)
      return
    }
    state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'custom-geometry', sourceKind, message: '自定义形状已转成路径。' })
    pushShape(state, node, text?.value ? elementId(state, `${id}-shape`, index) : id, bounds, 'path', path, fillKind, sourceKind)
  } else if (preset && PRESET_SHAPE[preset]) {
    pushShape(state, node, text ? elementId(state, `${id}-shape`, index) : id, bounds, PRESET_SHAPE[preset], undefined, fillKind, sourceKind)
  } else if (preset && presetPath(preset, bounds)) {
    const path = presetPath(preset, bounds)!
    state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'preset-shape', sourceKind, message: `预设形状「${preset}」已收成路径。` })
    pushShape(state, node, text ? elementId(state, `${id}-shape`, index) : id, bounds, 'path', path, fillKind, sourceKind)
  } else if (preset) {
    retain(state, node, index, 'preset-shape', `预设形状「${preset}」还不能映射，已按原位置保留。`, sourceKind)
    return
  }
  if (fillKind === 'picture') importPictureFill(state, node, id, bounds, preset, sourceKind)
  if (text?.value) {
    state.elements.push(textElement(state, id, text.value, bounds, txBody?.inner ?? '', text.runs))
    state.diagnostics.push({ level: text.runs ? 'approximate' : 'faithful', slide: state.slide, elementId: id, feature: 'text', sourceKind, message: '文本已写入工程。' })
  }
}

function pushShape(state: SlideState, node: XmlNode, id: string, bounds: Bounds, shape: NonNullable<DeckElement['shape']>, path: string | undefined, fillKind: ReturnType<typeof fillKindOf>, sourceKind?: SourceKind): void {
  const solid = fillKind === 'solid' ? paintOf(shapePaintXml(node), state.theme) : undefined
  const gradient = fillKind === 'gradient' ? gradientOf(shapePaintXml(node), state.theme, state) : undefined
  const pattern = fillKind === 'pattern' ? patternOf(shapePaintXml(node), state.theme, state) : undefined
  const line = lineOf(state, node)
  const visible = Boolean(solid || gradient || pattern || line || shape === 'line' || path)
  if (!visible) return
  const element: DeckElement = { id, type: 'shape', shape, bounds, role: state.decoration ? 'decoration' : shape === 'line' ? 'rule' : 'panel' }
  if (path) element.path = path
  if (solid) element.fill = bindColor(state, solid)
  if (gradient) element.gradient = gradient
  if (pattern) element.pattern = pattern
  if (line) element.line = line
  const shadow = shadowOf(state, node)
  if (shadow) element.shadow = shadow
  const arrow = arrowOf(node)
  if (arrow === 'other') state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'arrow', sourceKind, message: '箭头已记成线段，箭头样式没有写入。' })
  else if (arrow) element.arrow = arrow
  if (shape === 'roundRect') element.radius = radiusOf(node, bounds)
  const link = linkOf(state, node)
  if (link) element.link = { href: link }
  if (!element.fill && !element.gradient && !element.pattern && shape !== 'line') element.fill = '$paper'
  state.elements.push(element)
  state.diagnostics.push({ level: gradient || pattern || path ? 'approximate' : 'faithful', slide: state.slide, elementId: id, feature: 'shape', sourceKind, message: '形状已写入工程。' })
}

function importPicture(state: SlideState, node: XmlNode, index: number, sourceKind?: SourceKind): void {
  const id = elementId(state, shapeName(node) || `picture-${index}`, index)
  const raw = boundsOf(node)
  const bounds = raw ? place(raw, state.frame) : null
  if (!bounds) {
    state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: id, feature: 'bounds', sourceKind, message: '这张图片没有可用的边界，没有写入工程。' })
    return
  }
  if (/<a:videoFile\b|<p:video\b/.test(node.inner) || mediaKind(embedTarget(state, node), state.files) === 'video') {
    state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: id, feature: 'video', sourceKind, message: IMPORT_USER_MESSAGES.video })
    return
  }
  if (mediaKind(embedTarget(state, node), state.files) === 'audio') {
    state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: id, feature: 'audio', sourceKind, message: IMPORT_USER_MESSAGES.audio })
    return
  }
  const kind = mediaKind(embedTarget(state, node), state.files)
  if (kind === 'emf' || kind === 'wmf') {
    retain(state, node, index, kind, IMPORT_USER_MESSAGES[kind], sourceKind, id)
    return
  }
  const image = takeImage(state, node, id, bounds, sourceKind)
  if (image) {
    state.elements.push(image)
    return
  }
  if (kind !== 'png' && kind !== 'jpeg' && kind !== 'video' && kind !== 'audio') {
    retain(state, node, index, 'picture', IMPORT_USER_MESSAGES.retained, sourceKind, id)
  }
}

function importPictureFill(state: SlideState, node: XmlNode, id: string, bounds: Bounds, preset: string | undefined, sourceKind?: SourceKind): void {
  const image = takeImage(state, node, elementId(state, `${id}-fill`, 0), bounds, sourceKind)
  if (!image) {
    retain(state, node, 0, 'picture-fill', '形状上的图片填充已按原位置保留。', sourceKind)
    return
  }
  const mask = maskOf(preset)
  if (mask) image.mask = mask
  state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: image.id, feature: 'picture-fill', sourceKind, message: '形状上的图片填充已拆成图片。遮罩记在 mask 上。' })
  state.elements.push(image)
}

function takeImage(state: SlideState, node: XmlNode, id: string, bounds: Bounds, sourceKind?: SourceKind): DeckElement | null {
  const embed = attr(/<a:blip\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'r:embed')
  const rel = state.rels.find(item => item.id === embed)
  if (!rel || rel.external) {
    state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: id, feature: 'external-media', sourceKind, message: '外部图片没有写入工程。' })
    return null
  }
  const target = resolveRel(state.part, rel.target)
  const kind = mediaKind(target, state.files)
  if (kind !== 'png' && kind !== 'jpeg') return null
  const bytes = target ? state.files[target] : undefined
  if (!bytes) {
    state.diagnostics.push({ level: 'unsupported', slide: state.slide, elementId: id, feature: 'picture', sourceKind, message: '图片数据不在文件里，没有写入工程。' })
    return null
  }
  const assetName = `slide${state.slide}-${id}.${kind === 'png' ? 'png' : 'jpg'}`
  state.assets[assetName] = bytes
  const src = state.assetDir ? writeAsset(state.assetDir, assetName, bytes) : assetName
  const element: DeckElement = { id, type: 'image', bounds, src, alt: shapeName(node) || '导入图片', fit: 'fill', role: state.decoration ? 'decoration' : 'content' }
  const crop = cropOf(node)
  if (crop) {
    element.crop = crop
    state.diagnostics.push({ level: 'faithful', slide: state.slide, elementId: id, feature: 'picture-crop', sourceKind, message: '图片裁剪已写入 crop。' })
  }
  const geom = presetOf(node)
  if (geom && geom !== 'rect') element.mask = maskOf(geom)
  const link = linkOf(state, node)
  if (link) element.link = { href: link }
  state.diagnostics.push({ level: 'faithful', slide: state.slide, elementId: id, feature: 'picture', sourceKind, message: '图片已写入工程。' })
  return element
}

function cellFill(state: SlideState, cell: string): string | undefined {
  const tcPr = /<a:tcPr\b[\s\S]*?<\/a:tcPr>/.exec(cell)?.[0] ?? ''
  const color = tcPr ? paintOf(tcPr, state.theme) : undefined
  return color ? bindColor(state, color) : undefined
}

function retain(state: SlideState, node: XmlNode, index: number, feature: string, message: string, sourceKind?: SourceKind, existingId?: string): void {
  const id = existingId ?? elementId(state, shapeName(node) || feature, index)
  const raw = boundsOf(node)
  const bounds = raw ? place(raw, state.frame) : null
  state.diagnostics.push({ level: bounds ? 'retained' : 'unsupported', slide: state.slide, elementId: id, feature, sourceKind, message })
  if (!bounds) return
  state.fragments.push({ elementId: id, feature, xml: node.raw, media: collectMedia(state, node.raw) })
  state.elements.push({
    id,
    type: 'shape',
    shape: 'rect',
    bounds,
    role: 'decoration',
    fill: '$paper',
    retained: { feature, message },
  })
}

function tableOf(state: SlideState, node: XmlNode): DeckElement | 'merged' | null {
  if (/gridSpan="[2-9]|rowSpan="[2-9]|hMerge="1"|vMerge="1"/.test(node.inner)) return 'merged'
  const grid = [...node.inner.matchAll(/<a:gridCol\b[^>]*\bw="(\d+)"/g)].map(match => Number(match[1]))
  const rowsXml = [...node.inner.matchAll(/<a:tr\b([^>]*)>([\s\S]*?)<\/a:tr>/g)]
  if (grid.length === 0 || rowsXml.length === 0) return null
  const bounds = place(boundsOf(node) ?? { x: 48, y: 48, w: 400, h: 120 }, state.frame)
  const rows = rowsXml.map(match => {
    const cells = [...match[2]!.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map(cell => cell[0] ?? '')
    if (cells.length !== grid.length) return null
    return cells.map(cell => ({
      text: paragraphText(firstLocal(cell, 'txBody')?.inner ?? ''),
      bold: /\bb="(?:1|true)"/.test(cell) ? true as const : undefined,
      fill: cellFill(state, cell),
    }))
  })
  if (rows.some(row => !row)) return null
  const sum = grid.reduce((total, value) => total + value, 0) || 1
  const id = elementId(state, shapeName(node) || 'table', 1)
  const fontSize = Math.min(32, Math.max(12, fontSizeOf(node.inner)))
  return {
    id,
    type: 'table',
    bounds,
    role: 'content',
    table: {
      columns: grid.map(value => value / sum),
      rowHeights: rowsXml.map(match => Math.max(fontSize + 8, points(Number(attr(match[1] ?? '', 'h'))) ?? fontSize + 10)),
      rows: rows as NonNullable<typeof rows[number]>[],
      fontSize,
      fontFamily: containsCjk(rows.flat().map(cell => cell?.text ?? '').join('')) ? '$cjk' : '$latin',
      color: '$ink',
      fill: '$paper',
      border: { color: '$line', width: 0.75 },
      header: rows[0]?.some(cell => cell?.bold) ? { bold: true, fill: '$surface', color: '$ink' } : undefined,
    },
  }
}

function chartOf(state: SlideState, node: XmlNode): DeckElement | null {
  const relId = attr(/<c:chart\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'r:id')
  const rel = state.rels.find(item => item.id === relId && !item.external)
  const target = rel ? resolveRel(state.part, rel.target) : null
  const xml = target ? textOf(state.files, target) : ''
  if (!xml) return null
  rejectUnsafeXml(xml)
  const kind = chartKind(xml)
  if (!kind) return null
  const seriesXml = [...xml.matchAll(/<c:ser\b[\s\S]*?<\/c:ser>/g)].map(match => match[0] ?? '')
  if (seriesXml.length === 0) return null
  const categories = categoriesOf(seriesXml[0]!)
  const series = seriesXml.map(block => {
    const values = numbersOf(block, 'c:val').concat(kind === 'scatter' || kind === 'bubble' ? [] : numbersOf(block, 'c:yVal'))
    const ys = values.length > 0 ? values : numbersOf(block, 'c:yVal')
    return { name: decodeXml(/<c:tx\b[\s\S]*?<c:v>([^<]*)<\/c:v>/.exec(block)?.[1] ?? '系列'), values: ys }
  }).filter(item => item.values.length > 0)
  if (series.length === 0) return null
  const count = Math.max(categories.length, ...series.map(item => item.values.length))
  const cats = categories.length === count ? categories : Array.from({ length: count }, (_, item) => categories[item] ?? String(item + 1))
  const bounds = place(boundsOf(node) ?? { x: 48, y: 120, w: 480, h: 280 }, state.frame)
  const id = elementId(state, shapeName(node) || 'chart', 1)
  const chart: ChartSpec = {
    kind,
    categories: cats,
    series: series.map(item => ({ name: item.name || '系列', values: pad(item.values, count) })),
    showLegend: series.length > 1,
    showValues: false,
  }
  return { id, type: 'chart', bounds, role: 'content', chart }
}

function chartKind(xml: string): ChartSpec['kind'] | null {
  if (/<c:barChart\b/.test(xml)) {
    const grouping = /<c:grouping\b[^>]*\bval="([^"]+)"/.exec(xml)?.[1]
    if (grouping === 'stacked') return 'stacked'
    if (grouping === 'percentStacked') return 'stackedPercent'
    return /<c:barDir\b[^>]*\bval="bar"/.test(xml) ? 'bar' : 'column'
  }
  if (/<c:lineChart\b/.test(xml)) return 'line'
  if (/<c:pieChart\b/.test(xml)) return 'pie'
  if (/<c:doughnutChart\b/.test(xml)) return 'doughnut'
  if (/<c:areaChart\b/.test(xml)) return 'area'
  if (/<c:scatterChart\b/.test(xml)) return 'scatter'
  if (/<c:bubbleChart\b/.test(xml)) return 'bubble'
  if (/<c:radarChart\b/.test(xml)) return 'radar'
  return null
}

function categoriesOf(block: string): string[] {
  const cat = /<c:cat\b[\s\S]*?<\/c:cat>/.exec(block)?.[0] ?? ''
  const values = [...cat.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map(match => decodeXml(match[1] ?? ''))
  return values.filter(item => item.trim().length > 0)
}

function numbersOf(block: string, tag: string): number[] {
  const section = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`).exec(block)?.[0] ?? ''
  return [...section.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map(match => Number(match[1])).filter(value => Number.isFinite(value))
}

function pad(values: number[], count: number): number[] {
  return Array.from({ length: count }, (_, index) => values[index] ?? 0)
}

function readText(state: SlideState, txBody: string, id: string): { value: string; runs?: DeckElement['runs']; elementId?: string } | undefined {
  const paragraphs = [...txBody.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(match => match[1] ?? '')
  const source = paragraphs.length > 0 ? paragraphs : [txBody]
  const runs: NonNullable<DeckElement['runs']> = []
  let bullets = false
  source.forEach((paragraph, paragraphIndex) => {
    const bullet = bulletPrefix(paragraph, paragraphIndex)
    if (bullet) bullets = true
    const pieces = [...paragraph.matchAll(/<a:r\b[^>]*>([\s\S]*?)<\/a:r>/g)].map(match => match[1] ?? '')
    if (pieces.length === 0 && bullet) runs.push({ text: bullet.trim() })
    pieces.forEach((piece, pieceIndex) => {
      const text = `${pieceIndex === 0 ? bullet : ''}${decodeXml(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/.exec(piece)?.[1] ?? '')}`
      if (!text) return
      runs.push({
        text,
        size: fontSizeOf(piece),
        bold: /\bb="(?:1|true)"/.test(piece) ? true : undefined,
        italic: /\bi="(?:1|true)"/.test(piece) ? true : undefined,
        color: paintOf(piece, state.theme) ? bindColor(state, paintOf(piece, state.theme)!) : undefined,
      })
    })
    if (paragraphIndex < source.length - 1 && runs.length > 0) runs[runs.length - 1]!.text += '\n'
  })
  const value = runs.map(run => run.text).join('').trim()
  if (!value) return undefined
  if (/<a:hlinkClick\b/.test(txBody)) {
    const href = linkOf(state, { local: 'tx', attrs: '', inner: txBody, raw: txBody })
    if (href) state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'hyperlink', message: '超链接已写入 link.href。' })
    else state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'hyperlink', message: IMPORT_USER_MESSAGES.hyperlink })
  }
  if (bullets) state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'bullets', message: '项目符号已写进正文。' })
  if (/<a:spAutoFit\b|<a:normAutofit\b/.test(txBody)) state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'autofit', message: '已按文本框计算容量，没有改字号。' })
  const mixed = runs.length > 1 && new Set(runs.map(run => `${run.size}|${run.bold}|${run.color}`)).size > 1
  if (mixed) state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'rich-text', message: '同一文本框里的不同样式已写入 runs。' })
  return { value, runs: mixed ? runs : undefined }
}

function textElement(state: SlideState, id: string, value: string, bounds: Bounds, txBody: string, runs?: DeckElement['runs']): DeckElement {
  const size = fontSizeOf(txBody)
  const leading = leadingOf(txBody, size) ?? defaultLeading(size)
  const family = containsCjk(value) ? '$cjk' as const : '$latin' as const
  const color = paintOf(runPaintXml(txBody), state.theme) ?? state.theme.colors.ink
  const maxLines = Math.max(1, Math.floor((bounds.h + 0.5) / (size * leading)))
  const perLine = Math.max(1, Math.floor(bounds.w / Math.max(size, 1)))
  const glyphs = Array.from(value.replaceAll('\n', '')).length
  const link = linkOf(state, { local: 'tx', attrs: '', inner: txBody, raw: txBody })
  return {
    id,
    type: 'text',
    bounds,
    role: state.decoration ? 'decoration' : 'content',
    text: value,
    textCapacity: { maxChars: Math.max(glyphs, perLine * maxLines, 8), maxLines: Math.max(maxLines, value.split('\n').length) },
    font: {
      family,
      size,
      weight: /\bb="(?:1|true)"/.test(txBody) ? 'bold' : 'regular',
      italic: /\bi="(?:1|true)"/.test(txBody) ? true : undefined,
      color: bindColor(state, color),
      align: alignOf(txBody),
      valign: valignOf(txBody),
      leading,
      face: faceOf(txBody, state.theme),
    },
    runs,
    link: link ? { href: link } : undefined,
  }
}

function backgroundOf(state: SlideState, xml: string): { color: string; retainedXml?: string } {
  const bg = firstLocal(xml, 'bg')
  if (!bg) return { color: '$paper' }
  if (/<a:blipFill\b/.test(bg.inner) && /<a:tile\b/.test(bg.inner)) {
    state.diagnostics.push({ level: 'approximate', slide: state.slide, feature: 'background-tile', message: '平铺背景已按页面边界铺满。' })
    const size = attrBlock(textOf(state.files, 'ppt/presentation.xml'), 'sldSz')
    const width = points(Number(attr(size, 'cx'))) ?? 960
    const height = points(Number(attr(size, 'cy'))) ?? 540
    const image = takeImage(state, bg, elementId(state, 'background-tile', 1), { x: 0, y: 0, w: width, h: height }, undefined)
    if (image) {
      image.role = 'decoration'
      state.elements.unshift(image)
    }
    return { color: '$paper' }
  }
  if (/<a:blipFill\b/.test(bg.inner)) {
    state.diagnostics.push({ level: 'retained', slide: state.slide, feature: 'background-picture', message: '背景图片按原位置保留，不能在工程里改。导出时贴回，改版式时它不会跟着动。' })
    return { color: '$paper', retainedXml: bg.raw }
  }
  const color = paintOf(bg.inner, state.theme)
  return { color: color ? bindColor(state, color, 'paper') : '$paper' }
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
    id: 'imported',
    name: titleFrom(fileName),
    margin: 48,
    colors: { ink, paper, muted, accent, line: '#CBC8C0', surface, inverse: '#FFFFFF' },
    fonts: { cjk: { mac: ea, win: ea, linux: ea }, latin: { mac: latin, win: latin, linux: latin } },
    type: { display: { min: 44, max: 84 }, title: { min: 28, max: 36 }, body: { min: 16, max: 22 }, caption: { min: 11, max: 14 } },
    source: '由外来 PPTX 导入。配色来自文件主题或回退色，不是已发布模板。',
  }
}

function bindColor(state: SlideState, hex: string, prefer?: 'paper'): string {
  const upper = hex.toUpperCase()
  if (prefer === 'paper' && state.theme.colors.paper.toUpperCase() === upper) return '$paper'
  for (const key of ['ink', 'accent', 'muted', 'line', 'paper', 'surface', 'inverse'] as const) {
    if (state.theme.colors[key]?.toUpperCase() === upper) return `$${key}`
  }
  if (!state.diagnostics.some(item => item.feature === 'direct-color')) {
    state.diagnostics.push({ level: 'approximate', feature: 'direct-color', message: '有颜色写成了直接色值。和主题相同的颜色才会收成 token；这些直接色在整套换风格时不会跟着变。' })
  }
  return upper.startsWith('#') ? upper : `#${upper}`
}

function paintOf(xml: string, scheme: Record<string, string> | Theme): string | undefined {
  const colors = 'colors' in scheme ? schemeMap(scheme) : scheme
  const srgb = /<a:srgbClr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:srgbClr>)/.exec(xml)
  if (srgb && attr(srgb[1] ?? '', 'val')) return modulate(`#${attr(srgb[1] ?? '', 'val')!}`, srgb[2] ?? '')
  const schemeClr = /<a:schemeClr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:schemeClr>)/.exec(xml)
  if (schemeClr) {
    const token = attr(schemeClr[1] ?? '', 'val') ?? ''
    const mapped = colors[token]
    if (mapped) return modulate(mapped, schemeClr[2] ?? '')
  }
  const sys = /<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/.exec(xml)
  if (sys) return `#${sys[1]!.toUpperCase()}`
  return undefined
}

function schemeMap(theme: Theme): Record<string, string> {
  return { dk1: theme.colors.ink, lt1: theme.colors.paper, dk2: theme.colors.muted, lt2: theme.colors.surface, accent1: theme.colors.accent, ...theme.colors }
}

function modulate(hex: string, inner: string): string {
  if (!inner || !/<a:(?:shade|tint|lumMod)\b/.test(inner)) return hex.toUpperCase()
  let [r, g, b] = rgb(hex)
  const shade = numberAttr(inner, 'shade')
  const tint = numberAttr(inner, 'tint')
  const lumMod = numberAttr(inner, 'lumMod')
  if (shade !== undefined) { r *= shade; g *= shade; b *= shade }
  if (tint !== undefined) { r = r * tint + 255 * (1 - tint); g = g * tint + 255 * (1 - tint); b = b * tint + 255 * (1 - tint) }
  if (lumMod !== undefined) { r *= lumMod; g *= lumMod; b *= lumMod }
  return `#${[r, g, b].map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function rgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  return [Number.parseInt(raw.slice(0, 2), 16), Number.parseInt(raw.slice(2, 4), 16), Number.parseInt(raw.slice(4, 6), 16)]
}

function numberAttr(xml: string, name: string): number | undefined {
  const value = Number(attr(new RegExp(`<a:${name}\\b[^>]*>`).exec(xml)?.[0] ?? '', 'val'))
  return Number.isFinite(value) ? value / 100000 : undefined
}

function gradientOf(xml: string, theme: Theme, state: SlideState): GradientFill | undefined {
  const block = firstLocal(xml, 'gradFill')
  if (!block) return undefined
  const stops = topLevel(firstLocalIn(block, 'gsLst')?.inner ?? '').filter(node => node.local === 'gs').map(node => ({
    offset: Math.max(0, Math.min(1, Number(attr(node.attrs, 'pos') ?? '0') / 100000)),
    color: bindColor(state, paintOf(node.inner, theme) ?? theme.colors.ink),
  }))
  if (stops.length < 2) return undefined
  const radial = /<a:path\b[^>]*\bpath="circle"/.test(block.inner)
  if (!radial && !/<a:lin\b/.test(block.inner)) {
    state.diagnostics.push({ level: 'approximate', slide: state.slide, feature: 'gradient', message: '这种渐变已收成线性渐变。' })
  }
  const ang = Number(attr(/<a:lin\b[^>]*>/.exec(block.inner)?.[0] ?? '', 'ang'))
  return { kind: radial ? 'radial' : 'linear', angle: Number.isFinite(ang) ? ang / 60000 : 0, stops }
}

function patternOf(xml: string, theme: Theme, state: SlideState): PatternFill | undefined {
  const block = firstLocal(xml, 'pattFill')
  if (!block) return undefined
  const preset = attr(block.attrs, 'prst') ?? ''
  if (!/^[A-Za-z][A-Za-z0-9]{0,20}$/.test(preset)) return undefined
  const foreground = paintOf(firstLocalIn(block, 'fgClr')?.inner ?? '', theme) ?? theme.colors.ink
  const background = paintOf(firstLocalIn(block, 'bgClr')?.inner ?? '', theme) ?? theme.colors.paper
  return { preset, foreground: bindColor(state, foreground), background: bindColor(state, background) }
}

function shadowOf(state: SlideState, node: XmlNode): ShadowSpec | undefined {
  const shadow = firstLocal(node.inner, 'outerShdw')
  if (!shadow) return undefined
  const color = paintOf(shadow.inner || shadow.raw, state.theme)
  if (!color) return undefined
  const blur = points(Number(attr(shadow.attrs, 'blurRad'))) ?? undefined
  const offset = points(Number(attr(shadow.attrs, 'dist'))) ?? undefined
  const angle = Number(attr(shadow.attrs, 'dir'))
  const alpha = numberAttr(shadow.inner, 'alpha')
  return {
    color: bindColor(state, color),
    blur,
    offset,
    angle: Number.isFinite(angle) ? angle / 60000 : undefined,
    opacity: alpha,
  }
}

function lineOf(state: SlideState, node: XmlNode): DeckElement['line'] | undefined {
  const ln = /<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>/.exec(firstLocalIn(node, 'spPr')?.inner ?? '')
  if (!ln || /<a:noFill\s*\/>/.test(ln[2] ?? '')) return undefined
  const color = paintOf(ln[2] ?? '', state.theme)
  if (!color) return undefined
  const widthEmu = Number(attr(ln[1] ?? '', 'w'))
  const width = Number.isFinite(widthEmu) && widthEmu > 0 ? Math.max(0.25, points(widthEmu) ?? 1) : 1
  const dash = /prstDash\b[^>]*\bval="(dash|sysDash|dot|sysDot)"/.exec(ln[2] ?? '')?.[1]
  return { color: bindColor(state, color), width, style: dash?.includes('dot') ? 'dot' : dash ? 'dash' : undefined }
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
  const spPr = firstLocalIn(node, 'spPr') ?? firstLocalIn(node, 'grpSpPr')
  if (!spPr) return node.local === 'cxnSp' ? 'straightConnector1' : undefined
  if (firstLocalIn(spPr, 'custGeom')) return 'custom'
  return attr(firstLocalIn(spPr, 'prstGeom')?.attrs ?? '', 'prst') ?? (node.local === 'cxnSp' ? 'straightConnector1' : undefined)
}

function boundsOf(node: XmlNode): Bounds | null {
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

function groupFrame(node: XmlNode): Frame | null {
  const xfrm = firstLocalIn(firstLocalIn(node, 'grpSpPr') ?? node, 'xfrm')
  if (!xfrm) return null
  const off = firstLocalIn(xfrm, 'off')
  const ext = firstLocalIn(xfrm, 'ext')
  const chOff = firstLocalIn(xfrm, 'chOff')
  const chExt = firstLocalIn(xfrm, 'chExt')
  const ox = points(Number(attr(off?.attrs ?? '', 'x'))) ?? 0
  const oy = points(Number(attr(off?.attrs ?? '', 'y'))) ?? 0
  const cx = points(Number(attr(ext?.attrs ?? '', 'cx'))) ?? 0
  const cy = points(Number(attr(ext?.attrs ?? '', 'cy'))) ?? 0
  const chx = points(Number(attr(chOff?.attrs ?? '', 'x'))) ?? 0
  const chy = points(Number(attr(chOff?.attrs ?? '', 'y'))) ?? 0
  const chw = points(Number(attr(chExt?.attrs ?? '', 'cx'))) ?? cx
  const chh = points(Number(attr(chExt?.attrs ?? '', 'cy'))) ?? cy
  if (cx <= 0 || cy <= 0) return null
  return { ox, oy, sx: chw > 0 ? cx / chw : 1, sy: chh > 0 ? cy / chh : 1, chx, chy }
}

function compose(parent: Frame | null, child: Frame | null): Frame | null {
  if (!child) return parent
  if (!parent) return child
  return {
    ox: parent.ox + (child.ox - parent.chx) * parent.sx,
    oy: parent.oy + (child.oy - parent.chy) * parent.sy,
    sx: parent.sx * child.sx,
    sy: parent.sy * child.sy,
    chx: child.chx,
    chy: child.chy,
  }
}

function place(bounds: Bounds, frame: Frame | null): Bounds {
  if (!frame) return bounds
  return {
    x: round(frame.ox + (bounds.x - frame.chx) * frame.sx),
    y: round(frame.oy + (bounds.y - frame.chy) * frame.sy),
    w: Math.max(0.25, round(bounds.w * frame.sx)),
    h: Math.max(0.25, round(bounds.h * frame.sy)),
  }
}

function pathFromGeom(node: XmlNode, bounds: Bounds): string | null {
  const path = firstLocal(firstLocal(node.inner, 'pathLst')?.inner ?? '', 'path')
  if (!path) return null
  const width = Number(attr(path.attrs, 'w')) || bounds.w
  const height = Number(attr(path.attrs, 'h')) || bounds.h
  const sx = bounds.w / width
  const sy = bounds.h / height
  const commands: string[] = []
  for (const step of topLevel(path.inner)) {
    const point = (source: XmlNode | undefined) => {
      const x = Number(attr(source?.attrs ?? '', 'x'))
      const y = Number(attr(source?.attrs ?? '', 'y'))
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return `${round(x * sx)} ${round(y * sy)}`
    }
    if (step.local === 'moveTo') commands.push(`M ${point(firstLocalIn(step, 'pt'))}`)
    else if (step.local === 'lnTo') commands.push(`L ${point(firstLocalIn(step, 'pt'))}`)
    else if (step.local === 'cubicBezTo') {
      const pts = topLevel(step.inner).filter(item => item.local === 'pt').map(item => point(item))
      if (pts.length === 3 && pts.every(Boolean)) commands.push(`C ${pts.join(' ')}`)
    } else if (step.local === 'close') commands.push('Z')
    else return null
  }
  const pathText = commands.join(' ')
  return pathText.includes('null') || !pathText.trim() ? null : pathText
}

function presetPath(preset: string, bounds: Bounds): string | null {
  const { w, h } = bounds
  const s = round(Math.min(w, h) * 0.25)
  if (preset === 'triangle') return `M ${round(w / 2)} 0 L ${w} ${h} L 0 ${h} Z`
  if (preset === 'rtTriangle') return `M 0 0 L ${w} ${h} L 0 ${h} Z`
  if (preset === 'diamond') return `M ${round(w / 2)} 0 L ${w} ${round(h / 2)} L ${round(w / 2)} ${h} L 0 ${round(h / 2)} Z`
  if (preset === 'parallelogram') return `M ${s} 0 L ${w} 0 L ${round(w - s)} ${h} L 0 ${h} Z`
  if (preset === 'trapezoid') return `M ${s} 0 L ${round(w - s)} 0 L ${w} ${h} L 0 ${h} Z`
  if (preset === 'hexagon') return `M ${s} 0 L ${round(w - s)} 0 L ${w} ${round(h / 2)} L ${round(w - s)} ${h} L ${s} ${h} L 0 ${round(h / 2)} Z`
  if (preset === 'chevron' || preset === 'homePlate') return `M 0 0 L ${round(w - s)} 0 L ${w} ${round(h / 2)} L ${round(w - s)} ${h} L 0 ${h} Z`
  if (preset === 'pentagon') return `M ${round(w / 2)} 0 L ${w} ${round(h * 0.38)} L ${round(w * 0.8)} ${h} L ${round(w * 0.2)} ${h} L 0 ${round(h * 0.38)} Z`
  return null
}

function maskOf(preset: string | undefined): DeckElement['mask'] | undefined {
  if (!preset || preset === 'rect') return undefined
  if (preset === 'roundRect' || preset === 'ellipse') return { shape: preset }
  return undefined
}

function radiusOf(node: XmlNode, bounds: Bounds): number {
  const fmla = attr(/<a:gd\b[^>]*\bname="adj"[^>]*>/.exec(node.inner)?.[0] ?? '', 'fmla')
  const raw = Number(fmla?.replace(/^val\s+/, ''))
  const ratio = Number.isFinite(raw) ? raw / 100000 : 16667 / 100000
  return round(ratio * Math.min(bounds.w, bounds.h) / 2)
}

function cropOf(node: XmlNode): DeckElement['crop'] | undefined {
  const rect = /<a:srcRect\b[^>]*>/.exec(node.inner)?.[0]
  if (!rect) return undefined
  const part = (name: string) => {
    const value = Number(attr(rect, name) ?? '0')
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100000)) : 0
  }
  return { l: part('l'), t: part('t'), r: part('r'), b: part('b') }
}

function linkOf(state: SlideState, node: XmlNode): string | undefined {
  const relId = attr(/<a:hlinkClick\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'r:id')
  if (!relId) return undefined
  const rel = state.rels.find(item => item.id === relId)
  if (!rel?.external) return undefined
  const href = decodeXml(rel.target)
  return /^https?:\/\/\S+$/i.test(href) ? href : undefined
}

function collectMedia(state: SlideState, xml: string): RetainedMedia[] {
  const media: RetainedMedia[] = []
  for (const match of xml.matchAll(/\br:(?:embed|link|id)="([^"]+)"/g)) {
    const rel = state.rels.find(item => item.id === match[1] && !item.external)
    if (!rel) continue
    const target = resolveRel(state.part, rel.target)
    const bytes = target ? state.files[target] : undefined
    if (!target || !bytes) continue
    media.push({ relId: rel.id, type: rel.type, target, base64: Buffer.from(bytes).toString('base64') })
  }
  return media
}

function noteEffects(state: SlideState, node: XmlNode, id: string): void {
  if (/<a:effectLst\b|<a:effectDag\b|<a:scene3d\b|<a:sp3d\b|<a:prstTxWarp\b/.test(node.inner)) {
    state.diagnostics.push({ level: 'approximate', slide: state.slide, elementId: id, feature: 'effects', message: '发光、三维和艺术字变形没有写入。几何和文本仍按本页格式保留。' })
  }
}

function fillKindOf(node: XmlNode): 'none' | 'solid' | 'gradient' | 'picture' | 'pattern' {
  const xml = shapePaintXml(node)
  if (/<a:noFill\s*\/>/.test(xml)) return 'none'
  if (/<a:gradFill\b/.test(xml)) return 'gradient'
  if (/<a:blipFill\b/.test(xml)) return 'picture'
  if (/<a:pattFill\b/.test(xml)) return 'pattern'
  return /<a:srgbClr\b|<a:schemeClr\b|<a:sysClr\b/.test(xml) ? 'solid' : 'none'
}

function shapePaintXml(node: XmlNode): string {
  const spPr = firstLocalIn(node, 'spPr')
  if (!spPr) return ''
  return spPr.inner.replace(/<a:ln\b[\s\S]*<\/a:ln>/, '')
}

function runPaintXml(txBody: string): string {
  return /<a:rPr\b[\s\S]*?<\/a:rPr>/.exec(txBody)?.[0] ?? txBody
}

function fontSizeOf(txBody: string): number {
  const hundredths = Number(/<a:(?:rPr|defRPr)\b[^>]*\bsz="(\d+)"/.exec(txBody)?.[1] ?? 1800)
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

function bulletPrefix(paragraph: string, index: number): string {
  const symbol = attr(/<a:buChar\b[^>]*>/.exec(paragraph)?.[0] ?? '', 'char')
  if (symbol) return `${decodeXml(symbol)} `
  if (/<a:buAutoNum\b/.test(paragraph)) return `${index + 1}. `
  return ''
}

function paragraphText(txBody: string): string {
  return [...txBody.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1] ?? '')).join('').trim()
}

function faceOf(txBody: string, theme: Theme): FontFace | undefined {
  const latin = concreteFace(attr(/<a:latin\b[^>]*>/.exec(txBody)?.[0] ?? '', 'typeface')) ?? theme.fonts.latin.win
  const ea = concreteFace(attr(/<a:ea\b[^>]*>/.exec(txBody)?.[0] ?? '', 'typeface')) ?? theme.fonts.cjk.win
  if (!latin && !ea) return undefined
  const cjk = ea || latin
  const west = latin || ea
  return { latin: west, cjk: { mac: cjk, win: cjk, linux: cjk } }
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
  const minor = /<a:minorFont\b[^>]*>([\s\S]*?)<\/a:minorFont>/.exec(xml)?.[1] ?? xml
  return {
    latin: concreteFace(attr(/<a:latin\b[^>]*>/.exec(minor)?.[0] ?? '', 'typeface')),
    ea: concreteFace(attr(/<a:ea\b[^>]*>/.exec(minor)?.[0] ?? '', 'typeface')),
  }
}

function concreteFace(value: string | undefined): string | undefined {
  if (!value || value.startsWith('+')) return undefined
  return value
}

function shapeName(node: XmlNode): string {
  return attr(/<p:cNvPr\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'name') ?? ''
}

function elementId(state: SlideState, name: string, index: number): string {
  const cleaned = `${state.idPrefix}${name}`.trim().replace(/\s+/g, '-')
  const base = /^[\w\u4e00-\u9fff.-]{1,80}$/.test(cleaned) ? cleaned : `${state.idPrefix}s${state.slide}-e${index}`
  let id = base
  let n = 2
  while (state.used.has(id)) id = `${base}-${n++}`
  state.used.add(id)
  return id
}

function skippedPlaceholder(node: XmlNode): boolean {
  const ph = /<p:ph\b[^>]*>/.exec(node.inner)?.[0]
  if (!ph) return false
  return SKIP_PLACEHOLDER.has(attr(ph, 'type') || 'body')
}

function visualNodes(inner: string): XmlNode[] {
  return topLevel(inner).filter(node => !['nvGrpSpPr', 'grpSpPr', 'extLst', 'nvSpPr', 'spPr'].includes(node.local))
}

function sourceKindOf(local: string): SourceKind | undefined {
  if (local === 'sp' || local === 'pic' || local === 'cxnSp' || local === 'grpSp' || local === 'graphicFrame' || local === 'contentPart') return local
  return undefined
}

function embedTarget(state: SlideState, node: XmlNode): string | null {
  const embed = attr(/<a:blip\b[^>]*>/.exec(node.inner)?.[0] ?? '', 'r:embed')
  const rel = state.rels.find(item => item.id === embed)
  return rel && !rel.external ? resolveRel(state.part, rel.target) : null
}

function mediaKind(target: string | null, files: Record<string, Uint8Array>): string {
  const name = (target ?? '').toLowerCase()
  if (name.endsWith('.emf')) return 'emf'
  if (name.endsWith('.wmf')) return 'wmf'
  if (name.endsWith('.png')) return 'png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpeg'
  if (/\.(mp3|wav|m4a)$/.test(name)) return 'audio'
  if (/\.(mp4|mov|wmv|m4v)$/.test(name)) return 'video'
  const types = textOf(files, '[Content_Types].xml')
  const part = target ? `/${target}` : ''
  const content = new RegExp(`PartName="${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*ContentType="([^"]+)"`).exec(types)?.[1] ?? ''
  if (content.includes('emf')) return 'emf'
  if (content.includes('wmf')) return 'wmf'
  if (content.includes('png')) return 'png'
  if (content.includes('jpeg')) return 'jpeg'
  return 'other'
}

function attrBlock(xml: string, local: string): string {
  return firstLocal(xml, local)?.attrs ?? ''
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function titleFrom(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName
  const title = base.replace(/\.pptx$/i, '').trim()
  return title || '导入的演示文稿'
}

function writeAsset(dir: string, name: string, bytes: Uint8Array): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name.replace(/[^\w.\u4e00-\u9fff-]+/g, '_'))
  writeFileSync(path, bytes)
  return path
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
