/**
 * Word 模板保真写入与交付前版式守卫。
 *
 * 功能对齐 dsh-desktop 588412b `lib/docx-layout.py` 的 normalize / protected / inventory / edit / validate：
 * - 段落 ID 规则与 dsh 相同：`.//w:body//w:p` 文档顺序 → `p{i}`，其直接 run → `p{i}:r{j}`。
 *   ID 总是针对宿主持有的模板源（规范化后）计算，每次写入都从模板源重新开始，所以 ID 稳定。
 * - validate 的七项检查与 dsh 同名同序；dsh 遇到第一个问题就抛错，这里把全部问题收集成诊断清单，
 *   供交付守卫返回模型修订（needs_revision）。第一条诊断与 dsh 的报错一致。
 * - Selection 增量：run 级替换（run_id）、表格行克隆（row_additions，满足 T2 行动项表新增行）。
 * 实现为 TS（fflate + 受限 XML 树），不调用 Python，不打包 LibreOffice。
 */
import { createHash } from 'node:crypto'
import { strFromU8 } from 'fflate'
import { cloneParts, readOoxmlPackage, sameBytes, readXmlPart, writeOoxmlPackage, writeXmlPart, type OoxmlParts } from './ooxml-package.ts'
import {
  canonical,
  childrenNamed,
  cloneElement,
  createElement,
  descendants,
  elementChildren,
  firstChild,
  getAttr,
  insertAfter,
  insertBefore,
  is,
  named,
  parseXml,
  removeNode,
  setAttr,
  subElement,
  XML_NS,
  type XDocument,
  type XElement,
} from './xml-tree.ts'

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const MAX_TEXT = 32768
const MAX_PLAN_ITEMS = 1000

export interface IssuerHeaderProfile {
  paragraph: number
  text: string
  font: string
  sizeHalfPoints: number
  color: string
}

export interface DocxProfile { issuerHeader?: IssuerHeaderProfile }

export interface NativeRun { id: string; text: string; fonts: string; size: string | null; bold: boolean }
export interface NativeParagraph { id: string; text: string; can_remove: boolean; runs: NativeRun[] }

export interface TextFragment { source: string; text: string }
export interface ParagraphReplacement { paragraph_id?: string; id?: string; run_id?: string; text: string; runs?: TextFragment[] }
export interface ParagraphAddition { after_paragraph_id?: string; after?: string; style_from?: string; source?: string; text: string; runs?: TextFragment[] }
/** 克隆参照段落所在的表格行。cells[i] 为字符串或字符串数组（对应单元格内各段）。 */
export interface RowAddition { after_paragraph_id: string; cells: Array<string | string[]> }
export interface DocxEditPlan {
  replacements?: ParagraphReplacement[]
  additions?: ParagraphAddition[]
  row_additions?: RowAddition[]
  removals?: Array<string | { paragraph_id: string }>
}

export type DocxCheckId =
  | 'embedded-fonts-and-running-content'
  | 'style-and-theme-definitions'
  | 'page-geometry'
  | 'borders-and-drawing-frames'
  | 'template-font-assignments'
  | 'paragraph-and-run-styles'
  | 'editable-issuer-header'

export const DOCX_CHECKS: DocxCheckId[] = [
  'embedded-fonts-and-running-content',
  'style-and-theme-definitions',
  'page-geometry',
  'borders-and-drawing-frames',
  'template-font-assignments',
  'paragraph-and-run-styles',
  'editable-issuer-header',
]

export interface LayoutDiagnostic {
  check: DocxCheckId
  /** 给模型和用户看的中文说明。 */
  message: string
  /** dsh docx-layout.py 对同一问题的原文，用于对拍。 */
  dsh: string
  /** 怎样修。 */
  fix: string
  items?: string[]
}

export interface LayoutReport { ok: boolean; checks: DocxCheckId[]; diagnostics: LayoutDiagnostic[] }

export class DocxPlanError extends Error {
  constructor(message: string, readonly dsh: string) { super(message) }
}

// ── helpers ────────────────────────────────────────────────────────────────

function documentRoot(doc: XDocument): XElement { return doc.root }

/** `.//w:body//w:p` */
export function allParagraphs(doc: XDocument): XElement[] {
  return descendants(documentRoot(doc), W, 'body').flatMap(item => descendants(item, W, 'p'))
}

/** `.//w:body/w:p` */
function bodyParagraphs(doc: XDocument): XElement[] {
  return descendants(documentRoot(doc), W, 'body').flatMap(item => childrenNamed(item, W, 'p'))
}

export function paragraphText(element: XElement): string {
  let text = ''
  const visit = (node: XElement) => {
    if (is(node, W, 't')) {
      for (const child of node.children) if (child.type === 'text') text += child.value
    } else if (is(node, W, 'tab')) text += '\t'
    else if (is(node, W, 'br') || is(node, W, 'cr')) text += '\n'
    for (const child of elementChildren(node)) visit(child)
  }
  visit(element)
  return text
}

function pyRound(value: number): number {
  const floor = Math.floor(value)
  const diff = value - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new DocxPlanError('段落文字必须是字符串，且不超过 32768 字', 'Use bounded paragraph text')
  return value
}

function writeRunText(run: XElement, value: string): void {
  value.split('\n').forEach((line, index) => {
    if (index) subElement(run, W, 'br')
    line.split('\t').forEach((chunk, position) => {
      if (position) subElement(run, W, 'tab')
      const t = subElement(run, W, 't')
      setAttr(t, XML_NS, 'space', 'preserve')
      t.children.push({ type: 'text', value: chunk })
    })
  })
}

function setText(paragraph: XElement, value: unknown, fragments: TextFragment[] | undefined, prototypes: Map<string, XElement>): void {
  const text = boundedText(value)
  const runs = childrenNamed(paragraph, W, 'r')
  const prototype = runs.find(run => firstChild(run, W, 't')) ?? runs[0]
  let content: Array<[XElement | undefined, string]>
  if (fragments === undefined || fragments === null) content = [[prototype, text]]
  else {
    if (!Array.isArray(fragments) || fragments.length < 1 || fragments.length > 200) throw new DocxPlanError('runs 片段数量必须在 1–200 之间', 'Use a bounded list of native text styles')
    if (fragments.some(fragment => typeof fragment?.text !== 'string' || !prototypes.has(fragment?.source))) throw new DocxPlanError('runs 片段必须使用 office_template 返回的 run ID 和文字', 'Use recorded run IDs and text for mixed typography')
    if (fragments.map(fragment => fragment.text).join('') !== text) throw new DocxPlanError('runs 片段拼起来必须等于完整段落文字', 'Keep the complete paragraph text in its native text fragments')
    content = fragments.map(fragment => [prototypes.get(fragment.source), fragment.text])
  }
  paragraph.children = paragraph.children.filter(child => child.type === 'element' && (is(child, W, 'pPr') || is(child, W, 'bookmarkStart') || is(child, W, 'bookmarkEnd')))
  const end = firstChild(paragraph, W, 'bookmarkEnd')
  for (const [source, chunk] of content) {
    const run = createElement(paragraph, W, 'r')
    const rPr = source ? firstChild(source, W, 'rPr') : undefined
    if (rPr) { const copy = cloneElement(rPr, run); run.children.push(copy) }
    writeRunText(run, chunk)
    if (end) insertBefore(end, run)
    else { run.parent = paragraph; paragraph.children.push(run) }
  }
}

function setRunText(run: XElement, value: unknown): void {
  const text = boundedText(value)
  run.children = run.children.filter(child => child.type === 'element' && is(child, W, 'rPr'))
  writeRunText(run, text)
}

export function isProtectedParagraph(paragraph: XElement, profile: DocxProfile | null | undefined, index: number): boolean {
  return descendants(paragraph, W, 'drawing').length > 0
    || descendants(paragraph, W, 'pBdr').length > 0
    || descendants(paragraph, W, 'sectPr').length > 0
    || profile?.issuerHeader?.paragraph === index
}

function protectedReason(paragraph: XElement, profile: DocxProfile | null | undefined, index: number): string {
  if (descendants(paragraph, W, 'drawing').length) return '含图片或红头图形'
  if (descendants(paragraph, W, 'pBdr').length) return '带段落边框（分隔线 / 红线）'
  if (descendants(paragraph, W, 'sectPr').length) return '承载节属性（页边距、纸张、页眉页脚引用）'
  if (profile?.issuerHeader?.paragraph === index) return '是发文机关版头'
  return '是表格内段落，删除会破坏表格结构'
}

// ── normalize / inventory ─────────────────────────────────────────────────

export function normalizeDocx(parts: OoxmlParts, profile: DocxProfile | null | undefined): OoxmlParts {
  const header = profile?.issuerHeader
  if (!header) return parts
  const doc = readXmlPart(parts, 'word/document.xml')
  const paragraph = bodyParagraphs(doc)[header.paragraph]
  if (!paragraph) throw new Error('版头段落不存在')
  if (descendants(paragraph, W, 'drawing').length !== 1) throw new Error('The issuer-header source requires its recorded drawing')
  const extent = descendants(paragraph, WP, 'extent')[0]
  const height = extent ? Math.max(700, pyRound(Number(getAttr(extent, null, 'cy')) / 635)) : 1120
  paragraph.children = paragraph.children.filter(child => child.type === 'element' && is(child, W, 'pPr'))
  let pPr = firstChild(paragraph, W, 'pPr')
  if (!pPr) pPr = subElement(paragraph, W, 'pPr')
  const jc = firstChild(pPr, W, 'jc') ?? subElement(pPr, W, 'jc')
  setAttr(jc, W, 'val', 'center')
  const spacing = firstChild(pPr, W, 'spacing') ?? subElement(pPr, W, 'spacing')
  setAttr(spacing, W, 'line', String(height))
  setAttr(spacing, W, 'lineRule', 'atLeast')
  const snap = firstChild(pPr, W, 'snapToGrid') ?? subElement(pPr, W, 'snapToGrid')
  setAttr(snap, W, 'val', '0')
  const run = subElement(paragraph, W, 'r')
  const props = subElement(run, W, 'rPr')
  const fonts = subElement(props, W, 'rFonts')
  for (const kind of ['ascii', 'hAnsi', 'eastAsia']) setAttr(fonts, W, kind, header.font)
  setAttr(subElement(props, W, 'sz'), W, 'val', String(header.sizeHalfPoints))
  setAttr(subElement(props, W, 'color'), W, 'val', header.color)
  subElement(run, W, 't').children.push({ type: 'text', value: header.text })
  const next = cloneParts(parts)
  writeXmlPart(next, 'word/document.xml', doc)
  return next
}

export function inventoryDocx(parts: OoxmlParts, profile: DocxProfile | null | undefined): NativeParagraph[] {
  const doc = readXmlPart(parts, 'word/document.xml')
  return allParagraphs(doc).map((paragraph, index) => {
    const runs = childrenNamed(paragraph, W, 'r').map((run, position) => {
      const rPr = firstChild(run, W, 'rPr')
      const rFonts = rPr ? firstChild(rPr, W, 'rFonts') : undefined
      const fonts = rFonts ? rFonts.attrs.filter(([key]) => ['ascii', 'eastAsia'].includes(getAttrName(rFonts, key) ?? '')).map(([, value]) => value) : []
      const size = rPr ? firstChild(rPr, W, 'sz') : undefined
      const bold = rPr ? firstChild(rPr, W, 'b') : undefined
      const boldVal = bold ? getAttr(bold, W, 'val') ?? '1' : undefined
      return {
        id: `p${index}:r${position}`,
        text: paragraphText(run),
        fonts: fonts.join(',') || 'inherited',
        size: size ? getAttr(size, W, 'val') ?? null : 'inherited',
        bold: !!bold && !['0', 'false'].includes(boldVal!),
      }
    })
    return {
      id: `p${index}`,
      text: paragraphText(paragraph),
      can_remove: !!paragraph.parent && is(paragraph.parent, W, 'body') && !isProtectedParagraph(paragraph, profile, index),
      runs,
    }
  })
}

function getAttrName(element: XElement, key: string): string | undefined {
  const colon = key.indexOf(':')
  if (colon < 0) return undefined
  return element.ns.get(key.slice(0, colon)) === W ? key.slice(colon + 1) : undefined
}

// ── edit ─────────────────────────────────────────────────────────────────

function planList<T>(value: T[] | undefined, label: string): T[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_PLAN_ITEMS) throw new DocxPlanError(`${label} 必须是不超过 1000 项的数组`, 'Use a bounded edit plan')
  return value
}

export function editDocx(source: OoxmlParts, profile: DocxProfile | null | undefined, plan: DocxEditPlan): OoxmlParts {
  const parts = cloneParts(source)
  const doc = readXmlPart(parts, 'word/document.xml')
  const paragraphs = allParagraphs(doc)
  const lookup = new Map(paragraphs.map((paragraph, index) => [`p${index}`, paragraph]))
  const runLookup = new Map<string, XElement>()
  const prototypes = new Map<string, XElement>()
  paragraphs.forEach((paragraph, index) => childrenNamed(paragraph, W, 'r').forEach((run, position) => {
    runLookup.set(`p${index}:r${position}`, run)
    prototypes.set(`p${index}:r${position}`, cloneElement(run))
  }))
  const replacements = planList(plan.replacements, 'replacements')
  const additions = planList(plan.additions, 'additions')
  const rowAdditions = planList(plan.row_additions, 'row_additions')
  const removals = planList(plan.removals, 'removals')

  if (profile?.issuerHeader) {
    const header = bodyParagraphs(doc)[profile.issuerHeader.paragraph]
    const headerId = header ? `p${paragraphs.indexOf(header)}` : undefined
    if (!headerId || !replacements.some(item => (item.paragraph_id ?? item.id) === headerId)) {
      throw new DocxPlanError(`必须替换版头段落 ${headerId ?? ''}，填写本次的发文机关`, 'Fill the issuer header with the current issuing organization')
    }
  }

  const seen = new Set<string>()
  const runSeen = new Set<string>()
  for (const replacement of replacements) {
    if (replacement?.run_id !== undefined) {
      const key = replacement.run_id
      const run = runLookup.get(key)
      if (!run) throw new DocxPlanError(`run ID 不存在：${key}（零命中）`, 'Use each recorded paragraph ID once')
      if (runSeen.has(key) || seen.has(key.split(':')[0]!)) throw new DocxPlanError(`run ID 重复或与整段替换冲突：${key}`, 'Use each recorded paragraph ID once')
      runSeen.add(key)
      if (descendants(run, W, 'drawing').length) throw new DocxPlanError(`${key} 含图形，请用原生 Office 工作流编辑`, 'Edit drawing content with the native Office workflow')
      setRunText(run, replacement.text)
      continue
    }
    const key = replacement?.paragraph_id ?? replacement?.id
    if (typeof key !== 'string' || seen.has(key) || !lookup.has(key)) {
      throw new DocxPlanError(typeof key === 'string' && seen.has(key) ? `段落 ID 重复：${key}` : `段落 ID 不存在：${String(key)}（零命中）`, 'Use each recorded paragraph ID once')
    }
    if ([...runSeen].some(run => run.startsWith(`${key}:`))) throw new DocxPlanError(`段落 ${key} 已做 run 级替换，不能再整段替换`, 'Use each recorded paragraph ID once')
    seen.add(key)
    const paragraph = lookup.get(key)!
    if (descendants(paragraph, W, 'drawing').length) throw new DocxPlanError(`${key} 含图形，请用原生 Office 工作流编辑`, 'Edit drawing content with the native Office workflow')
    setText(paragraph, replacement.text, replacement.runs, prototypes)
  }

  const tails = new Map<string, XElement>()
  for (const addition of additions) {
    const after = addition?.after_paragraph_id ?? addition?.after
    const source = addition?.style_from ?? addition?.source ?? after
    if (typeof after !== 'string' || typeof source !== 'string' || !lookup.has(after) || !lookup.has(source)) {
      throw new DocxPlanError(`新增段落引用的段落 ID 不存在：after=${String(after)} style_from=${String(source)}`, 'Use recorded paragraph IDs for additions')
    }
    const origin = lookup.get(source)!
    if (isProtectedParagraph(origin, profile, paragraphs.indexOf(origin))) throw new DocxPlanError(`style_from=${source} 是受保护段落，请选正文段落作为样式来源`, 'Use a text paragraph as the addition style')
    const clone = cloneElement(origin)
    setText(clone, addition.text, addition.runs, prototypes)
    for (const marker of [...descendants(clone, W, 'bookmarkStart'), ...descendants(clone, W, 'bookmarkEnd')]) removeNode(marker)
    const anchor = tails.get(after) ?? lookup.get(after)!
    insertAfter(anchor, clone)
    tails.set(after, clone)
  }

  const rowTails = new Map<XElement, XElement>()
  for (const addition of rowAdditions) {
    const key = addition?.after_paragraph_id
    const paragraph = typeof key === 'string' ? lookup.get(key) : undefined
    if (!paragraph) throw new DocxPlanError(`新增表格行引用的段落 ID 不存在：${String(key)}（零命中）`, 'Use recorded paragraph IDs for additions')
    let row: XElement | undefined = paragraph.parent
    while (row && !named(row, W, 'tr')) row = row.parent
    if (!row) throw new DocxPlanError(`${key} 不在表格里，不能新增表格行`, 'Use recorded paragraph IDs for additions')
    const cells = childrenNamed(row, W, 'tc')
    if (!Array.isArray(addition.cells) || addition.cells.length !== cells.length) throw new DocxPlanError(`新增行需要 ${cells.length} 个单元格文字，收到 ${Array.isArray(addition.cells) ? addition.cells.length : 0} 个`, 'Use a bounded edit plan')
    const clone = cloneElement(row)
    childrenNamed(clone, W, 'tc').forEach((cell, index) => {
      const value = addition.cells[index]
      const lines = Array.isArray(value) ? value : [value]
      if (!lines.length || lines.length > 50) throw new DocxPlanError('每个单元格需要 1–50 段文字', 'Use a bounded edit plan')
      const cellParagraphs = childrenNamed(cell, W, 'p')
      if (!cellParagraphs.length) throw new DocxPlanError(`${key} 所在行有单元格没有段落`, 'Use recorded paragraph IDs for additions')
      let last = cellParagraphs[0]!
      lines.forEach((line, position) => {
        let target = cellParagraphs[position]
        if (!target) { target = cloneElement(cellParagraphs[cellParagraphs.length - 1]!); insertAfter(last, target) }
        setText(target, line, undefined, prototypes)
        last = target
      })
      for (const extra of cellParagraphs.slice(lines.length)) removeNode(extra)
    })
    for (const marker of [...descendants(clone, W, 'bookmarkStart'), ...descendants(clone, W, 'bookmarkEnd')]) removeNode(marker)
    const anchor = rowTails.get(row) ?? row
    insertAfter(anchor, clone)
    rowTails.set(row, clone)
  }

  for (const raw of removals) {
    const key = typeof raw === 'string' ? raw : raw?.paragraph_id
    if (typeof key !== 'string' || !lookup.has(key) || seen.has(key)) throw new DocxPlanError(`删除的段落 ID 不存在、重复或已被替换：${String(key)}`, 'Use distinct recorded paragraph IDs for removals')
    const paragraph = lookup.get(key)!
    const index = paragraphs.indexOf(paragraph)
    if (!paragraph.parent || !is(paragraph.parent, W, 'body') || isProtectedParagraph(paragraph, profile, index)) {
      throw new DocxPlanError(`段落 ${key} 受保护（${protectedReason(paragraph, profile, index)}），不能删除。can_remove=false 的段落只能替换文字`, 'Keep the template layout paragraphs and table structure')
    }
    removeNode(paragraph)
    seen.add(key)
  }
  writeXmlPart(parts, 'word/document.xml', doc)
  return parts
}

// ── validate ─────────────────────────────────────────────────────────────

function counter(values: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1)
  return map
}

function missingFrom(reference: Map<string, number>, proposed: Map<string, number>): number {
  let missing = 0
  for (const [key, count] of reference) missing += Math.max(0, count - (proposed.get(key) ?? 0))
  return missing
}

function fontAttrs(doc: XDocument): string[] {
  const found: string[] = []
  for (const element of descendants(doc.root, W, 'rFonts')) {
    for (const [key, value] of element.attrs) {
      const local = getAttrName(element, key)
      if (local === 'ascii' || local === 'hAnsi' || local === 'eastAsia') found.push(value)
    }
  }
  return found
}

function pageGeometry(section: XElement): string {
  const pick = (local: string) => firstChild(section, W, local)
  const size = pick('pgSz')
  const margin = pick('pgMar')
  const parts: string[] = []
  if (size) parts.push(`纸张 ${getAttr(size, W, 'w')}×${getAttr(size, W, 'h')}${getAttr(size, W, 'orient') ? ` ${getAttr(size, W, 'orient')}` : ''}`)
  if (margin) parts.push(`页边距 上${getAttr(margin, W, 'top')} 下${getAttr(margin, W, 'bottom')} 左${getAttr(margin, W, 'left')} 右${getAttr(margin, W, 'right')}`)
  const refs = [...childrenNamed(section, W, 'headerReference'), ...childrenNamed(section, W, 'footerReference')]
  parts.push(`页眉页脚引用 ${refs.length} 个`)
  return parts.join('，')
}

export function validateDocx(source: OoxmlParts, candidate: OoxmlParts, profile: DocxProfile | null | undefined): LayoutReport {
  const diagnostics: LayoutDiagnostic[] = []
  const expected = readXmlPart(source, 'word/document.xml')
  const actual = readXmlPart(candidate, 'word/document.xml')

  // 1. 嵌入字体、页眉页脚、字体表字节不变
  const running: string[] = []
  for (const [name, data] of Object.entries(source)) {
    if (name.startsWith('word/fonts/') || name.startsWith('word/footer') || name.startsWith('word/header') || name === 'word/fontTable.xml') {
      const other = candidate[name]
      if (!sameBytes(other, data)) running.push(other ? `${name}（已改动）` : `${name}（已删除）`)
    }
  }
  if (running.length) diagnostics.push({ check: 'embedded-fonts-and-running-content', message: '模板的嵌入字体、页眉或页脚被改动或删除', dsh: 'Preserve the template embedded fonts, headers and page-number footers', fix: '不要直接修改页眉、页脚和 word/fonts；从 office_template 的模板重新用 office_template_write 生成', items: running })

  // 2. styles / settings / theme
  const definitions: string[] = []
  for (const name of ['word/styles.xml', 'word/settings.xml', 'word/theme/theme1.xml']) {
    if (!(name in source)) continue
    if (!(name in candidate) || canonical(parseXml(strFromU8(candidate[name]!)).root) !== canonical(parseXml(strFromU8(source[name]!)).root)) definitions.push(name)
  }
  if (definitions.length) diagnostics.push({ check: 'style-and-theme-definitions', message: '样式表、文档设置或主题与模板不一致', dsh: 'Keep the selected Word style, settings and theme definitions', fix: '不要新增或修改样式定义；需要的样式用 additions 的 style_from 从模板段落继承', items: definitions })

  // 3. 节属性：页边距 / 纸张 / 方向 / 页眉页脚引用
  const expectedSections = descendants(expected.root, W, 'sectPr')
  const actualSections = descendants(actual.root, W, 'sectPr')
  if (expectedSections.length !== actualSections.length) {
    diagnostics.push({ check: 'page-geometry', message: `节数量从 ${expectedSections.length} 变成 ${actualSections.length}`, dsh: 'Preserve the template section layout', fix: '不要插入或删除分节符；保留模板的节结构' })
  } else {
    const changed: string[] = []
    expectedSections.forEach((left, index) => {
      const right = actualSections[index]!
      if (canonical(left) !== canonical(right)) changed.push(`第 ${index + 1} 节：模板 ${pageGeometry(left)}；当前 ${pageGeometry(right)}`)
    })
    if (changed.length) diagnostics.push({ check: 'page-geometry', message: '页面几何（页边距、纸张、方向或页眉页脚引用）与模板不一致', dsh: 'Preserve the template page geometry, section settings and header/footer references', fix: '恢复模板的 sectPr：不要改页边距、纸张大小、方向和页眉页脚引用', items: changed })
  }

  // 4. 边框、红线、图形框、表格属性与网格
  const frames: string[] = []
  let frameDsh = ''
  for (const [ns, local, message, dsh] of [
    [W, 'pBdr', '段落边框 / 红色分隔线', 'Preserve the template paragraph borders and red divider'],
    [WP, 'extent', '图形框尺寸', 'Preserve the template drawing frames'],
    [W, 'tblPr', '表格属性（边框、宽度）', 'Preserve the template table layout'],
    [W, 'tblGrid', '表格列宽网格', 'Preserve the template table columns'],
  ] as const) {
    const missing = missingFrom(counter(descendants(expected.root, ns, local).map(e => canonical(e))), counter(descendants(actual.root, ns, local).map(e => canonical(e))))
    if (missing) { frames.push(`${message}：缺少或被改动 ${missing} 处`); frameDsh ||= dsh }
  }
  if (frames.length) diagnostics.push({ check: 'borders-and-drawing-frames', message: '模板的边框、红线、图形框或表格结构被破坏', dsh: frameDsh, fix: '保留版头红线、分隔线和表格；新增表格行用 row_additions，不要改 tblPr / tblGrid', items: frames })

  // 5. 字体白名单
  const allowed = new Set(fontAttrs(expected))
  const extra = [...new Set(fontAttrs(actual))].filter(font => !allowed.has(font))
  if (extra.length) diagnostics.push({ check: 'template-font-assignments', message: `用了模板之外的字体：${extra.join('、')}`, dsh: 'Use the font assignments from the selected template', fix: `只用模板字体（${[...allowed].join('、') || '继承样式'}）；不要给 run 指定新字体`, items: extra })

  // 6. 段落与 run 样式白名单
  const styleIssues: string[] = []
  let styleDsh = ''
  for (const [kind, parent, message, dsh] of [
    ['pPr', 'p', '段落样式 / 间距', 'Use the selected template paragraph styles and spacing'],
    ['rPr', 'r', '文字字号 / 样式', 'Use the selected template text sizes and styles'],
  ] as const) {
    const pick = (doc: XDocument) => descendants(doc.root, W, 'body').flatMap(item => descendants(item, W, parent)).flatMap(owner => childrenNamed(owner, W, kind))
    const allowedProfiles = new Set(pick(expected).map(e => canonical(e)))
    const bad = pick(actual).filter(element => !allowedProfiles.has(canonical(element)))
    if (bad.length) {
      styleDsh ||= dsh
      const owners = bad.slice(0, 5).map(element => {
        let paragraph: XElement | undefined = element
        while (paragraph && !named(paragraph, W, 'p')) paragraph = paragraph.parent
        const text = paragraph ? paragraphText(paragraph).trim().slice(0, 24) : ''
        return `「${text || '（空段落）'}」`
      })
      styleIssues.push(`${message}不在模板里：${bad.length} 处，例如 ${owners.join('、')}`)
    }
  }
  if (styleIssues.length) diagnostics.push({ check: 'paragraph-and-run-styles', message: '出现了模板没有的段落或文字样式', dsh: styleDsh, fix: '新段落用 additions 的 style_from 继承模板段落；混排用 runs 指向原 run ID；不要手改字号、加粗、缩进', items: styleIssues })

  // 7. 版头可编辑
  const header = profile?.issuerHeader
  if (header) {
    const reference = bodyParagraphs(expected)[header.paragraph]
    const signatures = reference ? JSON.stringify(descendants(reference, W, 'rPr').map(e => canonical(e))) : ''
    const referencePPr = reference ? canonical(firstChild(reference, W, 'pPr')) : ''
    const matches = bodyParagraphs(actual).filter(paragraph => JSON.stringify(descendants(paragraph, W, 'rPr').map(e => canonical(e))) === signatures
      && paragraphText(paragraph).trim() && canonical(firstChild(paragraph, W, 'pPr')) === referencePPr)
    if (!matches.length) diagnostics.push({ check: 'editable-issuer-header', message: '发文机关版头不再是模板的红色可编辑文字', dsh: 'Keep an editable issuer header in the template red type style', fix: '用 replacements 改写版头段落的文字，不要删除或改成图片' })
  }

  const failed = new Set(diagnostics.map(item => item.check))
  return { ok: diagnostics.length === 0, checks: DOCX_CHECKS.filter(check => !failed.has(check)), diagnostics }
}

// ── 便捷入口 ─────────────────────────────────────────────────────────────

export interface PreparedDocx { bytes: Uint8Array; parts: OoxmlParts; paragraphs: NativeParagraph[] }

/** 读入模板原件并规范化（只在内存中；原件不写回）。 */
export function prepareDocxSource(templateBytes: Uint8Array, profile: DocxProfile | null | undefined): PreparedDocx {
  const raw = readOoxmlPackage(templateBytes)
  const parts = normalizeDocx(raw, profile)
  const bytes = profile?.issuerHeader ? writeOoxmlPackage(parts) : templateBytes
  return { bytes, parts, paragraphs: inventoryDocx(parts, profile) }
}

const sourceCache = new Map<string, OoxmlParts>()

/** 规范化后的模板源。按模板字节与 profile 缓存，模板原件只读。 */
function templateSource(templateBytes: Uint8Array, profile: DocxProfile | null | undefined): OoxmlParts {
  const key = `${createHash('sha256').update(templateBytes).digest('hex')}:${JSON.stringify(profile ?? null)}`
  const cached = sourceCache.get(key)
  if (cached) return cached
  const parts = normalizeDocx(readOoxmlPackage(templateBytes), profile)
  sourceCache.set(key, parts)
  while (sourceCache.size > 4) sourceCache.delete(sourceCache.keys().next().value!)
  return parts
}

export function writeDocxFromTemplate(templateBytes: Uint8Array, profile: DocxProfile | null | undefined, plan: DocxEditPlan): { bytes: Uint8Array; report: LayoutReport } {
  const source = templateSource(templateBytes, profile)
  const candidate = editDocx(source, profile, plan)
  const report = validateDocx(source, candidate, profile)
  return { bytes: writeOoxmlPackage(candidate), report }
}

export function validateDocxAgainstTemplate(templateBytes: Uint8Array, profile: DocxProfile | null | undefined, candidateBytes: Uint8Array): LayoutReport {
  return validateDocx(templateSource(templateBytes, profile), readOoxmlPackage(candidateBytes), profile)
}

export function formatLayoutDiagnostics(path: string, report: LayoutReport): string {
  const lines = [`${path} 未通过 Word 版式守卫（${report.diagnostics.length} 项）：`]
  report.diagnostics.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.check}] ${item.message}`)
    for (const detail of item.items?.slice(0, 8) ?? []) lines.push(`   - ${detail}`)
    lines.push(`   修复：${item.fix}`)
  })
  return lines.join('\n')
}

