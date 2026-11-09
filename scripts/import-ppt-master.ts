/**
 * Import ppt-master layouts and style methods into selection-deck.
 *
 * Reads SVG page templates and design_spec.md files. Does not import
 * templates/brands or the corporate decks (中国电信, 中汽研).
 *
 *   bun scripts/import-ppt-master.ts --input /tmp/ppt-master/skills/ppt-master/templates
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkDeck } from '../apps/electron/resources/skills/ppt-design/engine/check.ts'
import { contrastRatio, luminance } from '../apps/electron/resources/skills/ppt-design/engine/contrast.ts'
import { containsCjk, defaultLeading, fitSlack, orphanLines, textWidth, wrapText } from '../apps/electron/resources/skills/ppt-design/engine/metrics.ts'
import { parseDeckSource } from '../apps/electron/resources/skills/ppt-design/engine/schema.ts'
import { checkTheme } from '../apps/electron/resources/skills/ppt-design/engine/theme.ts'
import { canvasBySize, DECK_FORMAT, DECK_VERSION, type Deck, type DeckElement, type DeckPage, type Theme } from '../apps/electron/resources/skills/ppt-design/engine/types.ts'

const COPYRIGHT = 'Copyright (c) 2025-2026 Hugo He'
const SKILL = 'apps/electron/resources/skills/ppt-design'

type XmlNode = { tag: string; attrs: Record<string, string>; children: XmlNode[]; text: string }
type Palette = {
  ink: string
  paper: string
  muted: string
  accent: string
  line: string
  surface: string
  inverse: string
  signal: string
  good: string
  watch: string
  bad: string
}
type Family = 'sparse' | 'dense' | 'cards' | 'manual'
type Copy = {
  kicker: string
  title: string
  subtitle: string
  statement: string
  points: [string, string, string]
  bodies: [string, string, string]
  metrics: [{ n: string; label: string }, { n: string; label: string }, { n: string; label: string }]
  left: string
  right: string
  leftBody: string
  rightBody: string
  steps: [string, string, string, string]
  quote: string
  by: string
  colA: string
  colB: string
  times: [string, string, string, string]
  close: string
  source: string
}
type StyleDef = {
  id: string
  name: string
  when: string
  example: string
  paletteFrom: 'spec' | 'example'
  family: Family
  cover: 'ink' | 'paper' | 'split'
  serif: boolean
  footer: boolean
  radius: number
  chart: 'column' | 'bar' | 'line'
  hero?: string
  colors: Palette
  copy: Copy
}
type ThemeDef = {
  id: string
  name: string
  serif: boolean
  example: string
  note: string
  colors: Palette
}

const SANS: Theme['fonts'] = {
  cjk: { mac: 'PingFang SC', win: 'Microsoft YaHei', linux: 'Noto Sans CJK SC' },
  latin: { mac: 'Arial', win: 'Arial', linux: 'Arial' },
}
const SERIF: Theme['fonts'] = {
  cjk: { mac: 'Songti SC', win: 'SimSun', linux: 'Noto Serif CJK SC' },
  latin: { mac: 'Georgia', win: 'Georgia', linux: 'Georgia' },
}

const PARAGRAPH = '先写结论，再放能核对的证据。这一格只示范结构，不代表真实数据，换主题时这些字仍然可读。'

const SAMPLES: Record<string, string> = {
  TITLE: '把一件事说清楚',
  PAGE_TITLE: '这一页只留一个判断',
  SUBTITLE: '证据在左，下一步在右',
  KEY_MESSAGE: '先看变化，再谈原因',
  BODY: PARAGRAPH,
  BODY_TEXT: PARAGRAPH,
  CONTENT_AREA: PARAGRAPH,
  TOP_CONTENT: '上半部分只留一个事实',
  BOTTOM_CONTENT: '下半部分写下一步',
  FOOTER: '示例 · 非真实数据',
  FOOTER_NOTE: '示例 · 非真实数据',
  SOURCE: '示例来源',
  DATE: '2026',
  BRAND_LINE: '结构预览',
  CHAPTER_NUM: '01',
  CHAPTER_TITLE: '这一章只讲一件事',
  CHAPTER_DESC: '先看变化，再谈原因',
  PAGE_NUM: '07',
  QUOTE_TEXT: '把句子留在能被听见的长度',
  ATTRIBUTION: '示例说话人',
  ANNOTATION: '图注只说明这张图',
  SUPPORT_TEXT: '旁边这句是补充',
  CTA_TEXT: '下一步只做一件事',
  CLOSING_MESSAGE: '带走这一句',
  CONTACT_LINE: '结构预览',
  LEFT_TITLE: '改之前',
  RIGHT_TITLE: '改之后',
  LEFT_CONTENT: '先写下现在的做法',
  RIGHT_CONTENT: '再写下打算改的做法',
  LEFT_CAPTION: '左图说明',
  RIGHT_CAPTION: '右图说明',
  CAPTION: '图注',
  CAPTION_1: '第一张图注',
  CAPTION_2: '第二张图注',
  CAPTION_3: '第三张图注',
  CAPTION_4: '第四张图注',
  ITEM_1: '先确认事实',
  ITEM_2: '再写判断',
  ITEM_3: '最后给出下一步',
  ITEM_4: '记下还不知道的',
  ITEM_5: '把来源放在页脚',
  CARD_1: '第一点只说一件事',
  CARD_2: '第二点拿证据',
  CARD_3: '第三点写下一步',
  BLOCK_1: '第一块',
  BLOCK_2: '第二块',
  BLOCK_3: '第三块',
  KPI_1: '128',
  KPI_2: '36',
  KPI_3: '4',
  KPI_4: '12',
  STEP_1: '发现',
  STEP_2: '判断',
  STEP_3: '行动',
  STEP_4: '复核',
  QUADRANT_1: '先做',
  QUADRANT_2: '排后',
  QUADRANT_3: '少做',
  QUADRANT_4: '不做',
  X_AXIS: '时间',
  Y_AXIS: '结果',
}

function main(): void {
  const input = arg('--input') ?? '/tmp/ppt-master/skills/ppt-master/templates'
  assertSafeRoot(input)
  const skill = arg('--out') ?? SKILL
  const layoutRoot = join(input, 'layouts')
  const styleRoot = join(input, 'styles')
  const layoutCatalog: Record<string, unknown> = {}
  for (const id of LAYOUTS) {
    const dir = join(layoutRoot, id)
    const deck = convertLayout(id, dir)
    const spec = readFileSync(join(dir, 'templates', 'design_spec.md'), 'utf8')
    const preset = canvasBySize(deck.canvas.width, deck.canvas.height)
    mkdirSync(join(skill, 'layouts', id), { recursive: true })
    writeFileSync(join(skill, 'layouts', id, 'deck.json'), `${JSON.stringify(deck, null, 2)}\n`)
    writeFileSync(join(skill, 'layouts', id, 'design.md'), layoutDesign(id, deck, spec))
    layoutCatalog[id] = {
      name: LAYOUT_NAMES[id],
      design: `layouts/${id}/design.md`,
      deck: `layouts/${id}/deck.json`,
      canvas: preset?.label ?? '',
      pages: deck.pages.length,
      when: LAYOUT_WHEN[id],
      source: `ppt-master layout ${id}, MIT, ${COPYRIGHT}`,
      license: 'MIT',
    }
    console.log(`layout ${id} ${deck.pages.length} pages ${deck.canvas.width}×${deck.canvas.height}`)
  }
  mkdirSync(join(skill, 'layouts'), { recursive: true })
  writeFileSync(join(skill, 'layouts', 'catalog.json'), `${JSON.stringify(layoutCatalog, null, 2)}\n`)

  const catalog = JSON.parse(readFileSync(join(skill, 'styles', 'catalog.json'), 'utf8')) as Record<string, unknown>
  for (const style of STYLES) {
    assertPalette(style.id, style.colors)
    const deck = styleDeck(style)
    const issues = checkDeck(deck)
    if (issues.length) {
      console.error(style.id, issues.slice(0, 12))
      throw new Error(`${style.id} 预检未通过`)
    }
    const spec = readFileSync(join(styleRoot, style.id, 'templates', 'design_spec.md'), 'utf8')
    mkdirSync(join(skill, 'styles', style.id), { recursive: true })
    writeFileSync(join(skill, 'styles', style.id, 'deck.json'), `${JSON.stringify(deck, null, 2)}\n`)
    writeFileSync(join(skill, 'styles', style.id, 'design.md'), styleDesign(style, spec))
    catalog[style.id] = {
      name: style.name,
      design: `styles/${style.id}/design.md`,
      deck: `styles/${style.id}/deck.json`,
      when: style.when,
      source: `ppt-master style ${style.id}, MIT, ${COPYRIGHT}; palette from ${style.paletteFrom} ${style.example}`,
      license: 'MIT',
    }
    console.log(`style ${style.id} ok`)
  }
  writeFileSync(join(skill, 'styles', 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`)

  const themeCatalog: Record<string, unknown> = {}
  mkdirSync(join(skill, 'styles', 'themes'), { recursive: true })
  for (const theme of THEMES) {
    assertPalette(theme.id, theme.colors)
    const value = themeOf(theme.id, theme.name, theme.colors, theme.serif, theme.note)
    const probe = checkTheme(value)
    if (probe.length) {
      console.error(theme.id, probe)
      throw new Error(`${theme.id} 主题对比度未通过`)
    }
    writeFileSync(join(skill, 'styles', 'themes', `${theme.id}.json`), `${JSON.stringify(value, null, 2)}\n`)
    themeCatalog[theme.id] = {
      name: theme.name,
      file: `styles/themes/${theme.id}.json`,
      serif: theme.serif,
      example: theme.example,
      note: theme.note,
    }
    console.log(`theme ${theme.id} ok`)
  }
  writeFileSync(join(skill, 'styles', 'themes', 'catalog.json'), `${JSON.stringify(themeCatalog, null, 2)}\n`)
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function assertSafeRoot(root: string): void {
  const normalized = root.replace(/\\/g, '/')
  if (normalized.includes('/brands/') || normalized.includes('/decks/')) {
    throw new Error('不导入第三方品牌或企业整套')
  }
}

const LAYOUTS = ['editorial_bleed', 'moments_square', 'presentation_core', 'presentation_core_43', 'report_core', 'story_vertical', 'xiaohongshu_post']

const LAYOUT_NAMES: Record<string, string> = {
  editorial_bleed: '出血编辑 · Editorial Bleed',
  moments_square: '方寸 · Moments Square',
  presentation_core: '演示核心 · Presentation Core',
  presentation_core_43: '演示核心 4:3 · Presentation Core',
  report_core: '报告核心 · Report Core',
  story_vertical: '竖屏故事 · Story Vertical',
  xiaohongshu_post: '竖版图文 · Vertical Post',
}

const LAYOUT_WHEN: Record<string, string> = {
  editorial_bleed: '图片铺满画布，文字落在压暗的区域上。',
  moments_square: '正方形画布，横竖都能分栏。',
  presentation_core: '16:9 通用演示，含图表和表格页。',
  presentation_core_43: '4:3 投影或教室。',
  report_core: '带页眉页脚的报告页。',
  story_vertical: '9:16 竖屏故事，文字避开上下安全区。',
  xiaohongshu_post: '3:4 竖版图文。只借用版式，不使用平台标志。',
}

function layoutDesign(id: string, deck: Deck, spec: string): string {
  const preset = canvasBySize(deck.canvas.width, deck.canvas.height)
  return `# ${LAYOUT_NAMES[id]}

结构页从 ppt-master 的 SVG 版式转入（MIT，${COPYRIGHT}）。坐标按 96 dpi 的 0.75 倍换成磅。\`{{占位符}}\` 换成了简短中文示例。图片是虚线框，不是照片。渐变铺成一块约 40% 的黑色，引擎没有渐变。路径和标志没有转入。

默认主题是中性石板色，页面颜色都是 token，可以换成 \`styles/themes\` 里的任意主题。本套画布 ${deck.canvas.width}×${deck.canvas.height} pt（${preset?.label ?? ''}）。16:9 的对照尺寸仍是 960×540 pt。

下面是上游版式说明原文。

---

${spec.trim()}
`
}

function convertLayout(id: string, dir: string): Deck {
  const files = readdirSync(join(dir, 'templates')).filter(name => name.endsWith('.svg')).sort()
  const first = parseXml(readFileSync(join(dir, 'templates', files[0]!), 'utf8'))
  const canvas = canvasOf(first)
  const pages = files.map(file => convertSvg(readFileSync(join(dir, 'templates', file), 'utf8'), file))
  const deck: Deck = {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title: LAYOUT_NAMES[id] ?? id,
    canvas,
    theme: slateTheme(id),
    pages,
  }
  const parsed = parseDeckSource(JSON.stringify(deck))
  if (parsed.issues.length) {
    console.error(id, parsed.issues.slice(0, 16))
    throw new Error(`${id} 格式未通过`)
  }
  const issues = checkDeck(parsed.deck!)
  if (issues.length) {
    const preview = issues.slice(0, 20).map(item => `${item.code} ${item.pageId}:${item.elementId} ${item.message}`)
    console.error(preview.join('\n'))
    throw new Error(`${id} 预检 ${issues.length} 个问题`)
  }
  return parsed.deck!
}

function slateTheme(id: string): Theme {
  return themeOf(id, '石板预览', {
    ink: '#1E293B',
    paper: '#FFFFFF',
    muted: '#64748B',
    accent: '#334155',
    line: '#CBD5E1',
    surface: '#F4F6F8',
    inverse: '#F8FAFC',
    signal: '#475569',
    good: '#1F7A4D',
    watch: '#8A5A12',
    bad: '#8E2A24',
  }, false, 'ppt-master 版式的中性预览色，不是品牌色')
}

function canvasOf(root: XmlNode): { width: number; height: number } {
  const box = (root.attrs.viewBox ?? '').split(/[\s,]+/).map(Number)
  const width = box[2] ?? Number(root.attrs.width)
  const height = box[3] ?? Number(root.attrs.height)
  const preset = canvasBySize(round(width * 0.75), round(height * 0.75))
  if (!preset) throw new Error(`不支持的画布 ${width}×${height}`)
  return { width: preset.width, height: preset.height }
}

function convertSvg(source: string, file: string): DeckPage {
  const root = parseXml(source)
  const canvas = canvasOf(root)
  const box = (root.attrs.viewBox ?? '').split(/[\s,]+/).map(Number)
  const scaleX = canvas.width / (box[2] ?? canvas.width)
  const scaleY = canvas.height / (box[3] ?? canvas.height)
  const background = findBackground(root, scaleX, scaleY, canvas.width, canvas.height)
  const used = new Set<string>()
  const elements: DeckElement[] = []
  walk(root, null, {
    scaleX, scaleY, canvas, background, used, elements, skipBackground: true,
  })
  const stem = file.replace(/\.svg$/, '')
  return {
    id: stem.slice(0, 2),
    layout: stem,
    name: root.attrs['data-pptx-layout-name'] || stem,
    background,
    elements,
  }
}

type WalkState = {
  scaleX: number
  scaleY: number
  canvas: { width: number; height: number }
  background: string
  used: Set<string>
  elements: DeckElement[]
  skipBackground: boolean
}

function walk(node: XmlNode, bounds: string | null, state: WalkState): void {
  if (node.tag === 'defs' || node.tag === '#root') {
    if (node.tag === 'defs') return
  }
  const nextBounds = node.attrs['data-pptx-bounds'] ?? bounds
  const replace = node.attrs['data-pptx-replace-with']
  if (replace === 'chart' || replace === 'table') {
    const element = replace === 'chart' ? chartFrom(node, nextBounds, state) : tableFrom(node, nextBounds, state)
    if (element) state.elements.push(element)
    return
  }
  if (node.tag === 'rect' || node.tag === 'line' || node.tag === 'circle' || node.tag === 'ellipse' || node.tag === 'image' || node.tag === 'text') {
    const element = shapeFrom(node, nextBounds, state)
    if (element) state.elements.push(element)
    return
  }
  if (node.tag === 'path' || node.tag === 'polygon' || node.tag === 'polyline' || node.tag === 'metadata') return
  for (const child of node.children) walk(child, nextBounds, state)
}

function findBackground(root: XmlNode, scaleX: number, scaleY: number, width: number, height: number): string {
  let token = '$paper'
  const visit = (node: XmlNode) => {
    if (node.tag === 'defs') return
    if (node.tag === 'rect' && !String(node.attrs.fill ?? '').startsWith('url(')) {
      const box = boxOf(node, scaleX, scaleY, width, height)
      if (box && box.w >= width - 1 && box.h >= height - 1 && node.attrs.fill) token = luminance(normalizeColor(node.attrs.fill)) < 0.4 ? '$ink' : '$paper'
    }
    for (const child of node.children) visit(child)
  }
  visit(root)
  return token
}

function shapeFrom(node: XmlNode, bounds: string | null, state: WalkState): DeckElement | null {
  const { scaleX, scaleY, canvas, used, elements, background } = state
  if (node.tag === 'image') {
    const box = bounds ? parseBounds(bounds, scaleX, scaleY) : boxOf(node, scaleX, scaleY, canvas.width, canvas.height)
    if (!box) return null
    return {
      id: uniqueId(node.attrs.id || 'picture', used),
      type: 'shape',
      shape: 'rect',
      role: 'decoration',
      bounds: box,
      fill: '#00000000',
      line: { color: '$line', width: 1, style: 'dash' },
    }
  }
  if (node.tag === 'text') {
    const raw = innerText(node)
    if (!raw) return null
    const fontSize = clamp(Number(node.attrs['font-size'] ?? 16) * scaleY, 8, 80)
    const bold = node.attrs['font-weight'] === '700' || node.attrs['font-weight'] === 'bold'
    const anchor = node.attrs['text-anchor']
    const box = bounds
      ? parseBounds(bounds, scaleX, scaleY)
      : textBox(node, scaleX, scaleY, fontSize, bold, raw, anchor)
    if (!box) return null
    const fitted = fitText(raw, box.w, box.h, fontSize, bold)
    const behind = behindFill(elements, box, background)
    const color = textToken(node.attrs.fill ?? '#1E293B', behind)
    const align = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left'
    return {
      id: uniqueId(node.attrs.id || 'text', used),
      type: 'text',
      bounds: box,
      text: fitted.text,
      textCapacity: { maxChars: Array.from(fitted.text.replace(/\n/g, '')).length, maxLines: fitted.lines },
      font: {
        family: containsCjk(fitted.text) ? '$cjk' : '$latin',
        size: fitted.size,
        weight: bold ? 'bold' : 'regular',
        color,
        align,
        valign: 'top',
      },
    }
  }
  if (node.tag === 'line') {
    const x1 = Number(node.attrs.x1 ?? 0) * scaleX
    const y1 = Number(node.attrs.y1 ?? 0) * scaleY
    const x2 = Number(node.attrs.x2 ?? 0) * scaleX
    const y2 = Number(node.attrs.y2 ?? 0) * scaleY
    const stroke = clamp(Number(node.attrs['stroke-width'] ?? 1) * ((scaleX + scaleY) / 2), 0.5, 8)
    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    const box = clampBox({ x, y, w: Math.max(Math.abs(x2 - x1), 1), h: Math.max(Math.abs(y2 - y1), 1) }, canvas.width, canvas.height)
    if (!box) return null
    return {
      id: uniqueId(node.attrs.id || 'line', used),
      type: 'shape',
      shape: 'line',
      role: 'decoration',
      bounds: box,
      line: {
        color: '$line',
        width: round(stroke),
        points: { x1: round(x1 - box.x), y1: round(y1 - box.y), x2: round(x2 - box.x), y2: round(y2 - box.y) },
      },
    }
  }
  if (node.tag === 'circle' || node.tag === 'ellipse') {
    const cx = Number(node.attrs.cx ?? 0) * scaleX
    const cy = Number(node.attrs.cy ?? 0) * scaleY
    const rx = Number(node.attrs.r ?? node.attrs.rx ?? 0) * scaleX
    const ry = Number(node.attrs.r ?? node.attrs.ry ?? 0) * scaleY
    const box = clampBox({ x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }, canvas.width, canvas.height)
    if (!box) return null
    const fill = paintFill(node.attrs.fill)
    return {
      id: uniqueId(node.attrs.id || 'mark', used),
      type: 'shape',
      shape: 'ellipse',
      role: Math.min(box.w, box.h) >= 48 ? 'panel' : 'decoration',
      bounds: box,
      fill: fill ?? '$surface',
      line: node.attrs.stroke ? { color: '$line', width: round(clamp(Number(node.attrs['stroke-width'] ?? 1) * scaleX, 0.5, 6)) } : undefined,
    }
  }
  const box = boxOf(node, scaleX, scaleY, canvas.width, canvas.height)
  if (!box) return null
  if (box.w >= canvas.width - 1 && box.h >= canvas.height - 1 && !String(node.attrs.fill ?? '').startsWith('url(')) return null
  const gradient = String(node.attrs.fill ?? '').startsWith('url(')
  const fill = gradient ? '#00000066' : paintFill(node.attrs.fill)
  const radius = Number(node.attrs.rx ?? 0) * scaleX
  return {
    id: uniqueId(node.attrs.id || 'shape', used),
    type: 'shape',
    shape: radius >= 2 ? 'roundRect' : 'rect',
    role: gradient || Math.min(box.w, box.h) <= 14 ? 'decoration' : 'panel',
    bounds: box,
    fill: fill ?? '#00000000',
    line: node.attrs.stroke ? { color: '$line', width: round(clamp(Number(node.attrs['stroke-width'] ?? 1) * scaleX, 0.5, 6)) } : undefined,
    radius: radius >= 2 ? round(radius) : undefined,
  }
}

function chartFrom(node: XmlNode, bounds: string | null, state: WalkState): DeckElement | null {
  const meta = metadata(node)
  const box = meta
    ? clampBox({
      x: Number(meta.x ?? 0) * state.scaleX,
      y: Number(meta.y ?? 0) * state.scaleY,
      w: Number(meta.width ?? 0) * state.scaleX,
      h: Number(meta.height ?? 0) * state.scaleY,
    }, state.canvas.width, state.canvas.height)
    : bounds ? parseBounds(bounds, state.scaleX, state.scaleY) : null
  if (!box) return null
  const kind = String(meta?.type ?? 'column')
  const chartKind = kind === 'bar' || kind === 'line' || kind === 'pie' || kind === 'doughnut' ? kind : 'column'
  const categories = Array.isArray(meta?.categories) ? meta.categories.map(item => String(item)) : ['一', '二', '三', '四']
  const series = Array.isArray(meta?.series)
    ? meta.series.map(item => ({ name: String(item.name ?? '系列'), values: Array.isArray(item.values) ? item.values.map(value => Number(value)) : [1, 2, 3, 4] }))
    : [{ name: '实际', values: [42, 55, 63, 78] }]
  return {
    id: uniqueId(node.attrs.id || 'chart', state.used),
    type: 'chart',
    role: 'content',
    bounds: box,
    chart: {
      kind: chartKind,
      categories,
      series,
      colors: ['$accent', '$muted', '$signal'].slice(0, Math.max(series.length, 1)),
      showLegend: meta?.show_legend !== false,
      grid: 'solid',
    },
  }
}

function tableFrom(node: XmlNode, bounds: string | null, state: WalkState): DeckElement | null {
  const meta = metadata(node)
  const box = meta
    ? clampBox({
      x: Number(meta.x ?? 0) * state.scaleX,
      y: Number(meta.y ?? 0) * state.scaleY,
      w: Number(meta.width ?? 0) * state.scaleX,
      h: Number(meta.height ?? 0) * state.scaleY,
    }, state.canvas.width, state.canvas.height)
    : bounds ? parseBounds(bounds, state.scaleX, state.scaleY) : null
  if (!box) return null
  const columns = Array.isArray(meta?.column_widths) ? meta.column_widths.map(value => Number(value)) : [1, 1, 1]
  const sum = columns.reduce((total, value) => total + value, 0) || 1
  const header = Array.isArray(meta?.columns) ? meta.columns : []
  const body = Array.isArray(meta?.rows) ? meta.rows : []
  const rows = [header, ...body].filter(row => Array.isArray(row) && row.length > 0).map(row => row.map(cell => ({
    text: cellText(String(cell.text ?? '')),
    bold: cell.bold === true ? true : undefined,
    align: cell.align === 'r' ? 'right' as const : cell.align === 'c' ? 'center' as const : 'left' as const,
  })))
  if (rows.length === 0) return null
  const widthCount = rows[0]!.length
  const heights = Array.isArray(meta?.row_heights) ? meta.row_heights.map(value => Number(value) * state.scaleY) : []
  const rowHeights = rows.map((_, index) => round(heights[index] ?? box.h / rows.length))
  const fontSize = round(clamp(Number(meta?.style?.font_size ?? 16) * state.scaleY, 10, 18))
  return {
    id: uniqueId(node.attrs.id || 'table', state.used),
    type: 'table',
    role: 'content',
    bounds: box,
    table: {
      columns: columns.slice(0, widthCount).map(value => value / sum),
      rowHeights,
      rows,
      fontSize,
      fontFamily: '$cjk',
      color: '$ink',
      fill: '$paper',
      border: { color: '$line', width: 0.75 },
      header: { bold: true, color: '$ink', fill: '$surface' },
    },
  }
}

function cellText(value: string): string {
  const map: Record<string, string> = {
    Metric: '指标', Current: '现状', Target: '目标', Adoption: '采用', 'Cycle time': '周期', Quality: '质量', 'Cost index': '成本',
  }
  return map[value] ?? value
}

function metadata(node: XmlNode): Record<string, any> | null {
  const found = findTag(node, 'metadata')
  if (!found) return null
  try {
    return JSON.parse(innerText(found))
  } catch {
    return null
  }
}

function findTag(node: XmlNode, tag: string): XmlNode | null {
  if (node.tag === tag) return node
  for (const child of node.children) {
    const found = findTag(child, tag)
    if (found) return found
  }
  return null
}

function behindFill(elements: DeckElement[], box: { x: number; y: number; w: number; h: number }, page: string): string {
  const x = box.x + Math.min(8, box.w / 2)
  const y = box.y + Math.min(8, box.h / 2)
  let fill = page
  for (const element of elements) {
    if (element.type !== 'shape' || !element.fill || element.shape === 'line') continue
    if (element.bounds.w <= 2 || element.bounds.h <= 2) continue
    if (element.fill === '#00000000') continue
    const b = element.bounds
    if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue
    fill = element.fill
  }
  return fill
}

function textToken(hex: string, behind: string): string {
  if (behind === '$accent' || behind === '$signal') return '$inverse'
  if (behind === '$ink' || behind === '#00000066') return '$paper'
  return luminance(normalizeColor(hex)) < 0.12 ? '$ink' : '$muted'
}

function paintFill(value: string | undefined): string | undefined {
  if (!value || value === 'none') return undefined
  if (value.startsWith('url(')) return '#00000066'
  const hex = normalizeColor(value)
  const level = luminance(hex)
  if (level > 0.93) return '$paper'
  if (level > 0.75) return '$surface'
  if (level > 0.45) return '$accent'
  if (level > 0.2) return '$accent'
  return '$ink'
}

function fitText(raw: string, w: number, h: number, size: number, bold: boolean): { text: string; size: number; lines: number } {
  const token = raw.match(/^\{\{([A-Z0-9_]+)\}\}$/)
  const seed = token ? (SAMPLES[token[1]!] ?? PARAGRAPH) : raw
  let font = round(Math.min(size, Math.max(8, h)))
  while (font >= 8) {
    const packed = token ? pack(seed, w, h, font, bold) : (fits(seed, w, h, font, bold) ? seed : null)
    if (packed) {
      const lines = wrapText(packed, w, font, bold).length
      return { text: packed, size: font, lines }
    }
    font = round(font - 1)
  }
  return { text: '页', size: 8, lines: 1 }
}

function pack(seed: string, w: number, h: number, size: number, bold: boolean): string | null {
  const chars = Array.from(seed)
  let best = ''
  let lastStop = ''
  let cut = false
  for (let count = 1; count <= chars.length; count++) {
    const next = chars.slice(0, count).join('')
    if (!fits(next, w, h, size, bold)) {
      cut = true
      break
    }
    best = next
    if ('。，、；'.includes(chars[count - 1] ?? '')) lastStop = next
  }
  if (!cut) return best || null
  const trimmed = lastStop.replace(/[。，、；]+$/, '')
  if (trimmed && fits(trimmed, w, h, size, bold)) return trimmed
  return best || null
}

function fits(text: string, w: number, h: number, size: number, bold: boolean): boolean {
  if (!text.trim()) return false
  const lines = wrapText(text, w, size, bold)
  if (orphanLines(lines).length) return false
  const leading = defaultLeading(size)
  const needed = lines.length <= 1 ? size : size + (lines.length - 1) * size * leading
  if (needed > h + 1.5) return false
  const widest = lines.reduce((max, line) => Math.max(max, textWidth(line, size, bold)), 0)
  const room = containsCjk(text) ? 0.75 : fitSlack(size)
  return widest <= w + room
}

function textBox(node: XmlNode, scaleX: number, scaleY: number, fontSize: number, bold: boolean, raw: string, anchor: string | undefined): { x: number; y: number; w: number; h: number } | null {
  const x = Number(node.attrs.x ?? 0) * scaleX
  const baseline = Number(node.attrs.y ?? 0) * scaleY
  const width = Math.max(textWidth(raw, fontSize, bold) + 8, fontSize)
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
  return clampBox({ x: left, y: baseline - fontSize, w: width, h: fontSize * 1.25 }, 10000, 10000)
}

function boxOf(node: XmlNode, scaleX: number, scaleY: number, canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } | null {
  return clampBox({
    x: Number(node.attrs.x ?? 0) * scaleX,
    y: Number(node.attrs.y ?? 0) * scaleY,
    w: Number(node.attrs.width ?? 0) * scaleX,
    h: Number(node.attrs.height ?? 0) * scaleY,
  }, canvasW, canvasH)
}

function parseBounds(value: string, scaleX: number, scaleY: number): { x: number; y: number; w: number; h: number } | null {
  const [x, y, w, h] = value.split(/\s+/).map(Number)
  if ([x, y, w, h].some(item => !Number.isFinite(item))) return null
  return clampBox({ x: x! * scaleX, y: y! * scaleY, w: w! * scaleX, h: h! * scaleY }, 10000, 10000)
}

function clampBox(box: { x: number; y: number; w: number; h: number }, canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } | null {
  let { x, y, w, h } = box
  if (x < 0) { w += x; x = 0 }
  if (y < 0) { h += y; y = 0 }
  if (x + w > canvasW) w = canvasW - x
  if (y + h > canvasH) h = canvasH - y
  if (w < 1 || h < 1) return null
  return { x: round(x), y: round(y), w: round(w), h: round(h) }
}

function uniqueId(raw: string, used: Set<string>): string {
  let id = raw.replace(/[^A-Za-z0-9_-]/g, '') || 'el'
  if (/^[0-9]/.test(id)) id = `e${id}`
  let next = id
  let n = 2
  while (used.has(next)) next = `${id}-${n++}`
  used.add(next)
  return next
}

function normalizeColor(value: string): string {
  const hex = value.trim()
  if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toUpperCase()
  }
  return hex.slice(0, 7).toUpperCase()
}

function innerText(node: XmlNode): string {
  return `${node.text}${node.children.map(innerText).join('')}`.replace(/\s+/g, ' ').trim()
}

function parseXml(source: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  let index = 0
  while (index < source.length) {
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index)
      index = end + 3
      continue
    }
    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index)
      index = end + 2
      continue
    }
    if (source[index] === '<') {
      if (source[index + 1] === '/') {
        const end = source.indexOf('>', index)
        stack.pop()
        index = end + 1
        continue
      }
      const end = source.indexOf('>', index)
      let raw = source.slice(index + 1, end)
      const self = raw.endsWith('/')
      if (self) raw = raw.slice(0, -1).trim()
      const tag = raw.match(/^[^\s/>]+/)?.[0] ?? 'g'
      const node: XmlNode = { tag, attrs: parseAttrs(raw), children: [], text: '' }
      stack[stack.length - 1]!.children.push(node)
      if (!self) stack.push(node)
      index = end + 1
      continue
    }
    const next = source.indexOf('<', index)
    const text = decode(source.slice(index, next === -1 ? source.length : next))
    stack[stack.length - 1]!.text += text
    index = next === -1 ? source.length : next
  }
  return root.children[0] ?? root
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g
  for (const match of raw.matchAll(pattern)) {
    if (match.index === 0) continue
    attrs[match[1]!] = decode(match[2] ?? match[3] ?? '')
  }
  return attrs
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

function themeOf(id: string, name: string, colors: Palette, serif: boolean, source: string): Theme {
  return {
    id,
    name,
    margin: serif ? 64 : 48,
    colors: { ...colors },
    fonts: serif ? SERIF : SANS,
    type: {
      display: { min: 32, max: 72 },
      title: { min: 22, max: 40 },
      body: { min: 14, max: 22 },
      caption: { min: 10, max: 14 },
    },
    source,
  }
}

function assertPalette(name: string, colors: Palette): void {
  const need = (fg: string, bg: string, min: number, label: string) => {
    const ratio = contrastRatio(fg, bg)
    if (ratio + 0.02 < min) throw new Error(`${name} ${label} ${ratio.toFixed(2)} ${fg} on ${bg}`)
  }
  need(colors.ink, colors.paper, 4.5, 'ink/paper')
  need(colors.muted, colors.paper, 4.5, 'muted/paper')
  need(colors.ink, colors.surface, 4.5, 'ink/surface')
  need(colors.inverse, colors.accent, 4.5, 'inverse/accent')
  need(colors.accent, colors.paper, 3, 'accent/paper')
  need(colors.accent, colors.surface, 3, 'accent/surface')
}

function styleDesign(style: StyleDef, spec: string): string {
  const from = style.paletteFrom === 'spec'
    ? '写了色板。默认主题沿用说明里的通用色，不使用任何公司的品牌色。'
    : `没有写死色板。默认主题的颜色取自示例 \`${style.example}\` 的实际用色，缺的中性色按对比度补上。`
  return `# ${style.name}

本文件从 ppt-master（MIT，${COPYRIGHT}）的风格说明转入。上游说明${from}参考页是按这个方法写的 12 页中文示例，不是示例站点的逐页描摹，也不含第三方标志或企业稿。换主题时保持这些页面的 token。

- 示例：\`${style.example}\`
- 画布：960×540 pt
- 默认配色：纸色 ${style.colors.paper}，文字 ${style.colors.ink}，强调 ${style.colors.accent}

下面是上游说明原文。

---

${spec.trim()}
`
}

function styleDeck(style: StyleDef): Deck {
  return {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title: style.copy.title,
    canvas: { width: 960, height: 540 },
    theme: themeOf(style.id, style.name, style.colors, style.serif, `ppt-master style ${style.id}; ${style.example}`),
    pages: buildPages(style),
  }
}

function buildPages(style: StyleDef): DeckPage[] {
  const copy = style.copy
  const pad = style.family === 'sparse' ? 72 : 56
  const titleSize = style.family === 'sparse' ? 40 : style.family === 'manual' ? 28 : 32
  const pages: DeckPage[] = [
    coverPage(style, copy, pad, titleSize),
    page(style, '02', 'statement', '$paper', [
      kicker(style, copy.kicker, pad, 48),
      text('statement', copy.statement, pad, 150, 820, 140, style.family === 'sparse' ? 36 : 28, '$ink', true),
      text('source', copy.source, pad, 470, 480, 24, 13, '$muted'),
    ]),
    pointsPage(style, copy, pad),
    metricsPage(style, copy, pad),
    page(style, '05', 'compare', '$paper', [
      kicker(style, copy.kicker, pad, 40),
      text('title', '两边不要写成一句话', pad, 72, 640, 40, 26, '$ink', true),
      card('left', 56, 140, 400, 320, style),
      card('right', 504, 140, 400, 320, style),
      text('lt', copy.left, 80, 164, 352, 36, 22, '$ink', true),
      text('lb', copy.leftBody, 80, 214, 352, 28, 16, '$muted'),
      text('rt', copy.right, 528, 164, 352, 36, 22, '$ink', true),
      text('rb', copy.rightBody, 528, 214, 352, 28, 16, '$muted'),
    ]),
    processPage(style, copy, pad),
    page(style, '07', 'chart', '$paper', [
      kicker(style, copy.kicker, pad, 36),
      text('title', '一张图只说明一个变化', pad, 68, 640, 36, 24, '$ink', true),
      card('plot', 56, 130, 520, 340, style),
      chart('chart', 76, 150, 480, 300, style),
      text('read', copy.statement, 600, 160, 300, 80, 18, '$ink', true),
      text('source', copy.source, 600, 430, 300, 22, 12, '$muted'),
    ]),
    page(style, '08', 'quote', '$paper', [
      bar(style, 56, 120, 8, 220),
      text('quote', copy.quote, 88, 140, 760, 120, style.family === 'sparse' ? 32 : 26, '$ink', true),
      text('by', copy.by, 88, 280, 400, 28, 14, '$muted'),
    ]),
    page(style, '09', 'columns', '$paper', [
      text('title', '同一件事的两面', pad, 48, 640, 40, 26, '$ink', true),
      text('a', copy.colA, pad, 140, 380, 200, 18, '$ink'),
      text('b', copy.colB, 520, 140, 380, 200, 18, '$ink'),
      rule(56, 120, 848),
    ]),
    timelinePage(style, copy, pad),
    tablePage(style, copy, pad),
    page(style, '12', 'close', style.cover === 'ink' && style.family !== 'sparse' ? '$ink' : '$paper', [
      text('close', copy.close, pad, 200, 760, 80, style.family === 'sparse' ? 36 : 28, style.cover === 'ink' && style.family !== 'sparse' ? '$paper' : '$ink', true),
      text('source', copy.source, pad, 320, 400, 24, 13, style.cover === 'ink' && style.family !== 'sparse' ? '$paper' : '$muted'),
    ]),
  ]
  if (style.footer) {
    for (const item of pages) {
      if (item.layout.endsWith('-cover') || item.layout.endsWith('-close') || item.layout.endsWith('-quote')) continue
      item.elements.push(rule(56, 500, 848))
      item.elements.push(text('foot', copy.source, 56, 508, 360, 20, 11, '$muted'))
    }
  }
  return pages
}

function coverPage(style: StyleDef, copy: Copy, pad: number, titleSize: number): DeckPage {
  if (style.cover === 'split') {
    return page(style, '01', 'cover', '$paper', [
      { id: 'band', type: 'shape', shape: 'rect', role: 'panel', bounds: { x: 0, y: 0, w: 430, h: 540 }, fill: '$ink' },
      text('kicker', copy.kicker, 48, 150, 340, 24, 14, '$paper'),
      text('title', copy.title, 48, 190, 340, 120, 32, '$paper', true),
      text('sub', copy.subtitle, 480, 210, 420, 80, 20, '$ink'),
    ])
  }
  const dark = style.cover === 'ink'
  const fg = dark ? '$paper' : '$ink'
  const mute = dark ? '$paper' : '$muted'
  return page(style, '01', 'cover', dark ? '$ink' : '$paper', [
    bar(style, 0, 0, style.family === 'manual' ? 16 : 10, 540),
    text('kicker', copy.kicker, pad, 120, 640, 24, 14, mute),
    text('title', copy.title, pad, 170, 760, titleSize + 16, titleSize, fg, true),
    text('sub', copy.subtitle, pad, 170 + titleSize + 28, 640, 48, 18, mute),
  ])
}

function pointsPage(style: StyleDef, copy: Copy, pad: number): DeckPage {
  if (style.family === 'sparse') {
    return page(style, '03', 'points', '$paper', [
      text('title', '三件不能并成一句的事', pad, 56, 700, 40, 26, '$ink', true),
      text('n1', '01', pad, 150, 80, 36, 22, '$accent', true),
      text('t1', copy.points[0], pad + 90, 150, 640, 36, 22, '$ink', true),
      text('n2', '02', pad, 230, 80, 36, 22, '$accent', true),
      text('t2', copy.points[1], pad + 90, 230, 640, 36, 22, '$ink', true),
      text('n3', '03', pad, 310, 80, 36, 22, '$accent', true),
      text('t3', copy.points[2], pad + 90, 310, 640, 36, 22, '$ink', true),
    ])
  }
  const elements: DeckElement[] = [text('title', '三件不能并成一句的事', pad, 40, 700, 36, 26, '$ink', true)]
  for (let index = 0; index < 3; index++) {
    const x = 56 + index * 296
    elements.push(card(`card${index}`, x, 110, 276, 360, style))
    elements.push(text(`n${index}`, `0${index + 1}`, x + 20, 132, 80, 28, 16, '$accent', true))
    elements.push(text(`t${index}`, copy.points[index]!, x + 20, 176, 236, 36, 18, '$ink', true))
    elements.push(text(`b${index}`, copy.bodies[index]!, x + 20, 224, 236, 48, 14, '$muted'))
  }
  return page(style, '03', 'points', '$paper', elements)
}

function metricsPage(style: StyleDef, copy: Copy, pad: number): DeckPage {
  if (style.hero) {
    return page(style, '04', 'metrics', '$paper', [
      kicker(style, copy.kicker, pad, 80),
      text('hero', style.hero, pad, 150, 500, 120, 72, '$accent', true),
      text('label', copy.metrics[0]!.label, pad, 280, 420, 32, 18, '$ink'),
      text('note', copy.source, pad, 450, 420, 22, 12, '$muted'),
    ])
  }
  const elements: DeckElement[] = [text('title', '三个数，先看偏离', pad, 48, 640, 40, 26, '$ink', true)]
  copy.metrics.forEach((metric, index) => {
    const x = 56 + index * 296
    elements.push(card(`m${index}`, x, 140, 276, 250, style))
    elements.push(text(`n${index}`, metric.n, x + 20, 180, 236, 70, 40, '$ink', true))
    elements.push(text(`l${index}`, metric.label, x + 20, 270, 236, 32, 16, '$muted'))
  })
  return page(style, '04', 'metrics', '$paper', elements)
}

function processPage(style: StyleDef, copy: Copy, pad: number): DeckPage {
  const elements: DeckElement[] = [
    text('title', '顺序不能倒过来', pad, 48, 640, 40, 26, '$ink', true),
    rule(120, 210, 720),
  ]
  copy.steps.forEach((step, index) => {
    const x = 120 + index * 200
    elements.push({
      id: `dot${index}`,
      type: 'shape',
      shape: 'ellipse',
      role: 'decoration',
      bounds: { x: x - 8, y: 202, w: 16, h: 16 },
      fill: '$accent',
    })
    elements.push(text(`s${index}`, step, x - 40, 240, 140, 32, 16, '$ink', true))
  })
  return page(style, '06', 'process', '$paper', elements)
}

function timelinePage(style: StyleDef, copy: Copy, pad: number): DeckPage {
  const elements: DeckElement[] = [text('title', '时间只用来对证据', pad, 40, 640, 36, 26, '$ink', true)]
  copy.times.forEach((item, index) => {
    const y = 110 + index * 90
    elements.push(text(`d${index}`, `0${index + 1}`, pad, y, 70, 28, 16, '$accent', true))
    elements.push(text(`e${index}`, item, pad + 90, y, 640, 28, 18, '$ink'))
    elements.push(rule(pad, y + 48, 760))
  })
  return page(style, '10', 'timeline', '$paper', elements)
}

function tablePage(style: StyleDef, copy: Copy, pad: number): DeckPage {
  return page(style, '11', 'table', '$paper', [
    text('title', '表只比较能核对的项', pad, 36, 700, 36, 26, '$ink', true),
    {
      id: 'table',
      type: 'table',
      role: 'content',
      bounds: { x: 56, y: 110, w: 848, h: 250 },
      table: {
        columns: [0.4, 0.3, 0.3],
        rowHeights: [50, 50, 50, 50, 50],
        fontSize: 14,
        fontFamily: '$cjk',
        color: '$ink',
        fill: '$paper',
        border: { color: '$line', width: 0.75 },
        header: { bold: true, color: '$ink', fill: '$surface' },
        rows: [
          [{ text: '指标', bold: true }, { text: '现状', bold: true, align: 'right' }, { text: '目标', bold: true, align: 'right' }],
          [{ text: '采用' }, { text: '68%', align: 'right' }, { text: '80%', align: 'right' }],
          [{ text: '周期' }, { text: '12 天', align: 'right' }, { text: '8 天', align: 'right' }],
          [{ text: '质量' }, { text: '94%', align: 'right' }, { text: '97%', align: 'right' }],
          [{ text: '成本' }, { text: '1.08', align: 'right' }, { text: '1.00', align: 'right' }],
        ],
      },
    },
    text('note', copy.source, 56, 380, 400, 22, 12, '$muted'),
  ])
}

function page(style: StyleDef, id: string, layout: string, background: string, elements: DeckElement[]): DeckPage {
  return { id, layout: `${style.id}-${layout}`, name: layout, background, elements }
}

function card(id: string, x: number, y: number, w: number, h: number, style: StyleDef): DeckElement {
  return {
    id,
    type: 'shape',
    shape: style.radius >= 2 ? 'roundRect' : 'rect',
    role: 'panel',
    bounds: { x, y, w, h },
    fill: '$surface',
    line: style.family === 'manual' ? { color: '$line', width: 1 } : undefined,
    radius: style.radius >= 2 ? style.radius : undefined,
  }
}

function bar(style: StyleDef, x: number, y: number, w: number, h: number): DeckElement {
  return { id: 'accent-bar', type: 'shape', shape: 'rect', role: 'decoration', bounds: { x, y, w, h }, fill: '$accent' }
}

function rule(x: number, y: number, w: number): DeckElement {
  return {
    id: `rule-${y}`,
    type: 'shape',
    shape: 'line',
    role: 'decoration',
    bounds: { x, y, w, h: 1 },
    line: { color: '$line', width: 1, points: { x1: 0, y1: 0, x2: w, y2: 0 } },
  }
}

function kicker(style: StyleDef, value: string, x: number, y: number): DeckElement {
  return text('kicker', value, x, y, 480, 22, 13, '$muted')
}

function chart(id: string, x: number, y: number, w: number, h: number, style: StyleDef): DeckElement {
  return {
    id,
    type: 'chart',
    role: 'content',
    bounds: { x, y, w, h },
    chart: {
      kind: style.chart,
      categories: ['一季', '二季', '三季', '四季'],
      series: [
        { name: '实际', values: [42, 55, 63, 78] },
        { name: '计划', values: [48, 58, 68, 74] },
      ],
      colors: ['$accent', '$muted'],
      showLegend: style.family !== 'sparse',
      grid: style.family === 'sparse' ? 'none' : 'solid',
    },
  }
}

function text(id: string, value: string, x: number, y: number, w: number, h: number, size: number, color: string, bold = false): DeckElement {
  if (!fits(value, w, h, size, bold)) {
    const width = textWidth(value, size, bold)
    throw new Error(`${id}「${value}」放不进 ${w}×${h} @ ${size}（宽约 ${width.toFixed(0)}）`)
  }
  const lines = wrapText(value, w, size, bold)
  return {
    id,
    type: 'text',
    bounds: { x, y, w, h },
    text: value,
    textCapacity: { maxChars: Array.from(value.replace(/\n/g, '')).length, maxLines: lines.length },
    font: {
      family: containsCjk(value) ? '$cjk' : '$latin',
      size,
      weight: bold ? 'bold' : 'regular',
      color,
      align: 'left',
      valign: 'top',
    },
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const light = (colors: Partial<Palette> & Pick<Palette, 'ink' | 'paper' | 'muted' | 'accent' | 'surface' | 'inverse'>): Palette => ({
  line: '#D5D0C8',
  signal: colors.accent,
  good: '#1F7A4D',
  watch: '#8A5A12',
  bad: '#8E2A24',
  ...colors,
})

const dark = (colors: Partial<Palette> & Pick<Palette, 'ink' | 'paper' | 'muted' | 'accent' | 'surface' | 'inverse' | 'line'>): Palette => ({
  signal: colors.accent,
  good: '#7DCEA0',
  watch: '#E0B15A',
  bad: '#F0A8A4',
  ...colors,
})

const STYLES: StyleDef[] = [
  style('academic-research', '学术报告 · Academic Research', '从问题、方法和结果写出可以复核的判断，限度留在页上。', 'ppt169_researchstudio_reel_paper', 'example', 'cards', 'split', true, true, 0, 'column', undefined, light({
    ink: '#1B2430', paper: '#F7F5F1', muted: '#5C6570', accent: '#1D4ED8', surface: '#E8EEF6', inverse: '#FFFFFF', line: '#D5D0C8', signal: '#1D4ED8',
  }), copy('问题 · 方法 · 限度', '先把问题写清楚', '结果旁边留着限度', '阅读可以复核，才算报告', ['问题先写窄', '方法要能重做', '限度不要藏'], ['范围写在第一句', '步骤能被别人跟上', '做不到的写出来'], [{ n: '128', label: '纳入的样本' }, { n: '36', label: '被排除的' }, { n: '4', label: '还不稳定' }], '问题', '限度', '先写成一个可以否定的句子', '写明这页结论盖不住的部分', ['提问', '取样', '对照', '限度'], '限度不写，结论就过大', '复核人', '先问这句能不能被否定', '再问证据是不是这句需要的', ['写下问题', '固定样本', '对照方法', '标明限度'], '把限度留在最后一页')),
  style('consulting-decision', '决策备忘 · Consulting Decision', '结论先行，证据跟着判断，用来做决定而不是做展示。', 'a4_four_day_week_decision_memo', 'example', 'dense', 'paper', false, true, 0, 'bar', undefined, light({
    ink: '#16232E', paper: '#F6F3EE', muted: '#5C6570', accent: '#9A3412', surface: '#E7EEF1', inverse: '#F6F3EE', line: '#D5D0C8', signal: '#9A3412',
  }), copy('决定 · 代价 · 下一步', '这个决定先看代价', '证据不够就不要升格', '先选代价较小的那条', ['代价写在前面', '证据单独成行', '下一步只留一个'], ['谁付出，付出什么', '来源和期间写上', '本周能做完的'], [{ n: '2', label: '还没排除的选项' }, { n: '1', label: '建议采取的' }, { n: '0', label: '需要新数据的' }], '维持', '改道', '继续现在的做法', '换成代价更小的做法', ['列出选项', '写清代价', '排除', '决定'], '决定写在证据前面', '备忘', '维持会继续付出现在的代价', '改道要写明第一周做什么', ['周一对齐', '周三复核', '周五决定', '下周一执行'], '这周只做这一项')),
  style('creative-pitch', '创意提案 · Creative Pitch', '一个洞察先落地，再看它出现在每个接触点上。', 'ppt169_night_shelf_creative_pitch', 'example', 'sparse', 'paper', false, false, 0, 'column', undefined, dark({
    ink: '#EDEAE3', paper: '#0E0E10', muted: '#A29E97', accent: '#E9C877', surface: '#1A1A1C', inverse: '#0E0E10', line: '#3A3834', signal: '#E9C877',
  }), copy('夜里 · 货架 · 一句', '夜里的货架', '洞察先于口号', '人是在货架前决定的', ['只留一个洞察', '口号放在后面', '每个接触点同一句'], ['先看见真实场景', '不要用形容词开头', '海报和货架说同一句'], [{ n: '1', label: '这一页只留一句' }, { n: '3', label: '接触点' }, { n: '0', label: '多余的口号' }], '货架', '海报', '句子短到能被看见', '同一句，不换说法', ['看见', '写成一句', '放到货架', '再放到别处'], '夜里决定的是手，不是口号', '提案', '货架上只能读完一句', '海报上仍然是这一句', ['观察', '一句', '货架', '延展'], '把那一句留下来')),
  style('duty-manual', '值班手册 · Duty Manual', '把分散的规则收成一条判断轴：先讲机制，再写规则。', 'ppt169_fire_control_room_duty_manual', 'spec', 'manual', 'paper', false, true, 0, 'line', undefined, dark({
    ink: '#DCE6F0', paper: '#0E1B2E', muted: '#8FA3BC', accent: '#4A9FD8', surface: '#1A2C46', inverse: '#0E1B2E', line: '#2A3F5C', signal: '#D8F04A', good: '#D8F04A', watch: '#E0B15A', bad: '#E85D2B',
  }), copy('机制 · 规则 · 值班', '先看哪一块', '规则要能回到机制', '先看报警，再看人', ['先看哪一块屏', '规则对应哪条机制', '禁止写在单独一列'], ['不要从口号看起', '每条都能指回上一页', '危险和正确分开'], [{ n: '4', label: '必须先看的块' }, { n: '1', label: '当前级别' }, { n: '0', label: '没有出处的规则' }], '正确', '禁止', '级别内可以做的', '这一级不能做的', ['看屏', '对机制', '执行', '记录'], '没有机制出处的规则不写上来', '值班', '先看的那一块要固定', '禁止项不跟正确项混写', ['接班', '看屏', '处置', '交班'], '先看屏，再行动')),
  style('incident-postmortem', '事故复盘 · Incident Postmortem', '按时间线复盘，把因素和责备分开，行动要能核对。', 'spec:incident-postmortem', 'spec', 'dense', 'paper', false, true, 0, 'line', undefined, light({
    ink: '#1F2933', paper: '#FFFFFF', muted: '#4A5568', accent: '#B4342C', surface: '#F2F4F6', inverse: '#FFFFFF', line: '#D5D8DE', signal: '#B4342C', good: '#2E7D5B', watch: '#8A5A12', bad: '#B4342C',
  }), copy('时间 · 因素 · 行动', '只留下事实', '不写责备，写因素', '影响窗口要写清楚', ['时间线先排好', '因素和人分开', '行动要能核对'], ['开始、发现、恢复', '写条件，不写人名', '负责人只对行动'], [{ n: '46', label: '分钟的影响窗口' }, { n: '3', label: '促成因素' }, { n: '2', label: '要核对的行动' }], '事实', '猜测', '日志里能对上的', '还没有证据的', ['发现', '遏制', '恢复', '复核'], '窗口写完，再写因素', '复盘', '时间来自日志', '因素不是责任人名单', ['02:14 发现', '02:31 遏制', '03:00 恢复', '次日复核'], '行动写到能被核对')),
  style('investor-pitch', '融资叙事 · Investor Pitch', '从为什么是现在讲到这一步要买到什么，靠证据而不是形容词。', 'ppt169_heatline_seed_pitch', 'example', 'sparse', 'paper', false, false, 0, 'column', '18%', light({
    ink: '#1F2733', paper: '#FBF7F1', muted: '#6B6154', accent: '#B84312', surface: '#F3EDE4', inverse: '#FBF7F1', line: '#E4DCD0', signal: '#D65A1E',
  }), copy('现在 · 证据 · 这一步', '钱要买到哪一步', '形容词不算进展', '这一步只买一个结果', ['为什么是现在', '证据单独一页', '钱对应哪一步'], ['时间窗口写具体', '数字带来源', '不买一个形容词'], [{ n: '18%', label: '已经重复的部分' }, { n: '1', label: '这一轮要买的结果' }, { n: '3', label: '还没有的证据' }], '已经有的', '还没有的', '能重复的事实', '不能写成已经完成', ['窗口', '证据', '这一步', '不做的'], '钱要买到一个能核对的结果', '叙事', '已经重复的写上来', '还没发生的不要提前', ['看见窗口', '核对证据', '写下这一步', '停掉形容词'], '这一步只买这一结果')),
  style('mbb-consulting', '战略备忘 · Strategy Document', '结论先行的文档密度：编号证据、一列判断、每页一个行动标题。不代表任何咨询公司。', 'ppt169_ev_market_priorities', 'spec', 'dense', 'ink', false, true, 0, 'bar', undefined, light({
    ink: '#051C2C', paper: '#FFFFFF', muted: '#5A5A5A', accent: '#2251FF', surface: '#F7F7F7', inverse: '#FFFFFF', line: '#B7B7B7', signal: '#2251FF', bad: '#B3261E',
  }), copy('判断 · 证据 · 行动', '先改优先级', '资源跟着优先级走', '先改排序，再谈加人', ['一页一个行动标题', '证据编号', '判断单独一列'], ['标题就是结论', '图注写来源', '不要把建议藏在表里'], [{ n: '3', label: '优先项' }, { n: '1', label: '这页要改的' }, { n: '0', label: '未编号的判断' }], '优先', '延后', '这季度要改的排序', '证据不够的先不动', ['标题', '编号', '判断', '行动'], '行动标题先写，证据后补', '备忘', '排序变了，资源才变', '没有编号的判断不进正文', ['写下结论', '给证据编号', '改排序', '再谈资源'], '先改排序')),
  style('narrative-keynote', '叙事主旨 · Narrative Keynote', '用张力、转折和具体细节把一个想法讲完。一页只有一个节拍。', 'ppt169_qianli_jiangshan_scroll', 'example', 'sparse', 'paper', true, false, 0, 'column', undefined, light({
    ink: '#1F2422', paper: '#F3ECDA', muted: '#6E675B', accent: '#2B5C8A', surface: '#E7F0EA', inverse: '#F7F3E8', line: '#D9D0C2', signal: '#A8734A',
  }), copy('看见 · 转折 · 一句', '青绿是一种看见', '一页只留一个节拍', '先看见，再命名', ['先给一个现场', '转折只留一句', '不要在页上写讲稿'], ['听众能核对的场景', '这一页最空', '讲的人还在说话'], [{ n: '1', label: '这一页的节拍' }, { n: '0', label: '页脚' }, { n: '1', label: '要记住的句子' }], '现场', '转折', '听众已经认识的世界', '理解变了的那一句', ['现场', '张力', '转折', '带走'], '转折那一页应当最空', '讲述', '现场要具体', '转折不要加第二句', ['放进一个现场', '让张力站住', '只留转折', '不要总结'], '带走这一句')),
  style('operating-review', '经营复盘 · Operating Review', '把结果、偏离、原因和承诺分开，坏数字不要涂软。', 'spec:operating-review', 'spec', 'dense', 'paper', false, true, 0, 'column', undefined, light({
    ink: '#1E293B', paper: '#FFFFFF', muted: '#5A6A7A', accent: '#2B6CB0', surface: '#F4F6F8', inverse: '#FFFFFF', line: '#D5DCE3', signal: '#2B6CB0', good: '#2E7D5B', watch: '#8A5A12', bad: '#B4342C',
  }), copy('结果 · 偏离 · 承诺', '哪一项偏离了', '坏数字保持坏的颜色', '先看偏离，再看原因', ['结果和目标并排', '偏离不要平均掉', '承诺写到人'], ['同一期间', '方向和幅度都写', '下周能核对'], [{ n: '1', label: '低于承诺的项' }, { n: '2', label: '仍在观察' }, { n: '4', label: '按计划' }], '按计划', '偏离', '达到了写明的线', '差在哪一段', ['结果', '偏离', '原因', '承诺'], '偏离的项不要跟达标的项混色', '复盘', '数字来自这周的口径', '承诺写上下次看什么', ['读结果', '标出偏离', '写原因', '留下承诺'], '偏离的项单独留下')),
  style('product-launch', '产品发布 · Product Launch', '能力先被演示，再被命名。一页只讲一件事。', 'ppt169_uv_launch', 'example', 'sparse', 'paper', false, false, 0, 'line', undefined, dark({
    ink: '#E6EDF3', paper: '#0B1220', muted: '#9BA9BC', accent: '#4CC9F0', surface: '#131C2E', inverse: '#0B1220', line: '#243349', signal: '#FF8A3D',
  }), copy('演示 · 一句 · 名称', '只讲一件事', '先看见，再给名字', '这一页只发生一件事', ['先演示', '再命名', '不要并列三个功能'], ['观众先看见变化', '名字放在演示之后', '其余的改到后面'], [{ n: '1', label: '这一页的变化' }, { n: '0', label: '同时出场的功能' }, { n: '1', label: '要记住的名字' }], '看见', '命名', '屏幕上先变化', '名字只出现一次', ['演示', '停顿', '命名', '停'], '名字出现之前，变化已经看见', '发布', '一页一件事', '名称不提前', ['打开', '演示', '命名', '离开'], '记住这一个变化')),
  style('science-explainer', '科学讲解 · Science Explainer', '从熟悉的现象走到名字，不拿准确去换轻松。', 'ppt43_sleep_science_explainer', 'example', 'cards', 'paper', true, true, 8, 'column', undefined, light({
    ink: '#2A2622', paper: '#FBF5E9', muted: '#5C554C', accent: '#2E4A7D', surface: '#F3E6D4', inverse: '#FBF5E9', line: '#E4D8C8', signal: '#2E4A7D',
  }), copy('现象 · 类比 · 名字', '先看见现象', '名字放在现象之后', '先看见，再给它一个名字', ['从熟悉的现象开始', '类比要标成类比', '名字最后出现'], ['听众已经见过', '类比不是证据', '术语只出现一次'], [{ n: '1', label: '这页的现象' }, { n: '1', label: '类比' }, { n: '0', label: '提前的术语' }], '现象', '名字', '看得见的变化', '这个变化叫什么', ['现象', '类比', '机制', '名字'], '类比旁边要写明它不是证据', '讲解', '现象写具体', '名字不要先出现', ['指出现象', '给一个类比', '讲机制', '再给名字'], '名字放在最后')),
  style('solution-proposal', '方案建议 · Solution Proposal', '先证明听懂了，再给出可以被否决的做法和代价。', 'ppt169_every_day_counts_proposal', 'example', 'cards', 'split', false, true, 16, 'bar', undefined, light({
    ink: '#23282D', paper: '#F4F1EC', muted: '#5A6368', accent: '#1F4B57', surface: '#E7EEF0', inverse: '#F4F1EC', line: '#D9D3CB', signal: '#C45A12',
  }), copy('理解 · 做法 · 代价', '方案要能被否决', '代价写在做法旁边', '听懂之后再写做法', ['先复述问题', '做法要具体', '代价写在旁边'], ['用对方的词', '谁在什么时候做', '不做也会有代价'], [{ n: '3', label: '可以否决的做法' }, { n: '1', label: '建议先做的' }, { n: '2', label: '写明的代价' }], '问题', '做法', '我们听到的', '建议先做的一件', ['复述', '做法', '代价', '否决'], '不能被否决的方案还没写完', '建议', '问题用对方的说法', '做法写到周', ['复述问题', '给一个做法', '写代价', '留下否决条件'], '可以否决，再谈')),
  style('technical-deepdive', '技术深潜 · Technical Deep Dive', '先画边界和约束，再谈优化。机制要能被观察到。', 'ppt169_raft_consensus_deepdive', 'spec', 'manual', 'paper', false, true, 0, 'line', undefined, dark({
    ink: '#E6EDF5', paper: '#0F1C2B', muted: '#8AA0B8', accent: '#4FC9E8', surface: '#16283C', inverse: '#0F1C2B', line: '#4A7BA7', signal: '#E8A54F',
  }), copy('边界 · 约束 · 观察', '先画边界', '优化留在边界里面', '先写做不到什么', ['边界先画出来', '约束写成可以观察的', '优化不越界'], ['系统不负责的部分', '失败时能看见什么', '快一点不能改语义'], [{ n: '3', label: '写明的边界' }, { n: '2', label: '可观察的失败' }, { n: '1', label: '还不能优化的' }], '边界内', '边界外', '这一层负责的', '交给别的层', ['画边界', '写约束', '观察', '再谈快'], '看不到的失败不要写成已经处理', '深潜', '边界用线标出', '约束要能被观察', ['画出一层', '写下做不到的', '给出观察点', '暂停优化'], '边界还在，再谈快')),
  style('workshop-teaching', '工作坊 · Workshop Teaching', '目标、示范、练习和检查理解排成一次课。', 'ppt169_how_color_works_workshop', 'example', 'cards', 'paper', false, true, 12, 'column', undefined, light({
    ink: '#23201C', paper: '#FAF8F4', muted: '#6B6259', accent: '#A8452B', surface: '#F0EBE3', inverse: '#FAF8F4', line: '#E4DDD4', signal: '#3E5C6B',
  }), copy('目标 · 示范 · 练习', '今天能做一次', '离开时要能独立做一遍', '先看一遍，再自己做', ['目标写成能做到的', '示范不要跳步', '练习当场做完'], ['离开时的动作', '每一步都看得见', '做完能说哪里不会'], [{ n: '1', label: '今天的目标' }, { n: '3', label: '示范步骤' }, { n: '1', label: '当场练习' }], '示范', '练习', '跟着做的一遍', '自己做的一遍', ['目标', '示范', '练习', '检查'], '检查理解时允许说不会', '课程', '目标是一个动作', '练习不要留到课后', ['写下目标', '完整示范', '自己做一次', '说出不会的'], '离开时能做一次')),
]

function style(id: string, name: string, when: string, example: string, paletteFrom: 'spec' | 'example', family: Family, cover: 'ink' | 'paper' | 'split', serif: boolean, footer: boolean, radius: number, chart: 'column' | 'bar' | 'line', hero: string | undefined, colors: Palette, copy: Copy): StyleDef {
  return { id, name, when, example, paletteFrom, family, cover, serif, footer, radius, chart, hero, colors, copy }
}

function copy(kicker: string, title: string, subtitle: string, statement: string, points: [string, string, string], bodies: [string, string, string], metrics: Copy['metrics'], left: string, right: string, leftBody: string, rightBody: string, steps: [string, string, string, string], quote: string, by: string, colA: string, colB: string, times: [string, string, string, string], close: string): Copy {
  return { kicker, title, subtitle, statement, points, bodies, metrics, left, right, leftBody, rightBody, steps, quote, by, colA, colB, times, close, source: '示例 · 非真实数据' }
}

const THEMES: ThemeDef[] = [
  { id: 'jiangshan', name: '千里青绿', serif: true, example: 'ppt169_qianli_jiangshan_scroll', note: '受「千里江山图·十八岁的青绿」的青绿色和暖纸色启发。不使用那幅画，也不嵌入画作。', colors: light({ ink: '#1F2422', paper: '#F3ECDA', muted: '#6E675B', accent: '#2B5C8A', surface: '#E7F0EA', inverse: '#F7F3E8', line: '#D9D0C2', signal: '#A8734A' }) },
  { id: 'sugar-rush', name: '糖彩', serif: false, example: 'ppt169_sugar_rush_memphis', note: '受 Memphis 风格示例 Sugar Rush 的高饱和撞色启发。名称和配色是自拟的，不是那个示例的标志。', colors: light({ ink: '#1A1A2E', paper: '#FFF8EE', muted: '#5C5670', accent: '#EB3898', surface: '#FFF1D6', inverse: '#1A1A2E', line: '#E4D5C4', signal: '#A34710' }) },
  { id: 'glass-saas', name: '玻璃界面', serif: false, example: 'ppt169_glassmorphism_demo', note: '受玻璃拟态界面示例的冷色雾面启发。没有复制其中的产品界面。', colors: light({ ink: '#1E1B4B', paper: '#F4F6FB', muted: '#5B6178', accent: '#4F46E5', surface: '#E8EAF6', inverse: '#FFFFFF', line: '#D4D7E8', signal: '#4F46E5' }) },
  { id: 'paper-cut', name: '剪纸月色', serif: false, example: 'ppt169_mid_autumn_papercut', note: '受中秋剪纸示例的夜蓝和暖纸色启发。没有使用节日品牌或剪纸图案文件。', colors: light({ ink: '#131A33', paper: '#F2ECE0', muted: '#5C6578', accent: '#1E3A5F', surface: '#E4E8F2', inverse: '#F7F3EA', line: '#D5D0C4', signal: '#8A6A1E' }) },
  { id: 'pixel-breakfast', name: '像素早餐', serif: false, example: 'ppt169_pixel_breakfast_atlas', note: '受像素早餐图鉴的深靛底和蛋黄、番茄色启发。没有嵌入像素画。', colors: light({ ink: '#1A1C2C', paper: '#F4F0E6', muted: '#5A6178', accent: '#A34710', surface: '#E7E3F2', inverse: '#F4F0E6', line: '#D9D4C8', signal: '#A34710' }) },
  { id: 'swiss-grid', name: '瑞士网格', serif: false, example: 'ppt169_swiss_grid_systems', note: '受瑞士网格示例和一张红黑信息图的网格、单一红色启发。不是任何国家或机构的标志色使用规范。', colors: light({ ink: '#141414', paper: '#F7F7F5', muted: '#5A5A5A', accent: '#C8102E', surface: '#EEEEEE', inverse: '#FFFFFF', line: '#141414', signal: '#C8102E' }) },
  { id: 'tea-tasting', name: '点茶', serif: true, example: 'xiaohongshu_song_diancha', note: '受宋人点茶图文的茶褐、朱印和暖纸色启发。没有使用器物照片。', colors: light({ ink: '#2B2A28', paper: '#F5EFE2', muted: '#6A645C', accent: '#9E2E26', surface: '#EBE4D4', inverse: '#F8F3E8', line: '#D9D0C0', signal: '#9E2E26' }) },
  { id: 'brutal-stone', name: '粗石', serif: false, example: 'ppt169_brutalism_field_guide', note: '受粗野主义建筑图解的石色、近黑和一块红启发。没有使用建筑照片或事务所名称。', colors: light({ ink: '#14110F', paper: '#F2F0EA', muted: '#55514A', accent: '#C8331E', surface: '#E6E2D8', inverse: '#F7F5F0', line: '#1C1A17', signal: '#C8331E' }) },
  { id: 'zine-shelf', name: '独立书摊', serif: false, example: 'ppt169_indie_bookstore_zine_guide', note: '受独立书店小册子示例的奶油纸、一块蓝和一块粉启发。没有使用书店名称或封面。', colors: light({ ink: '#1A1A1A', paper: '#F5EFE0', muted: '#5A5A5A', accent: '#1E4DBC', surface: '#E7EFEA', inverse: '#FFFFFF', line: '#1A1A1A', signal: '#C22555' }) },
  { id: 'keynote-stage', name: '暗场讲台', serif: false, example: '', note: '自拟的暗场讲台：近黑底、暖色信号。不是任何公司的发布会配色，没有标志。', colors: dark({ ink: '#F5F5F7', paper: '#0E0E10', muted: '#A1A1A6', accent: '#FF6B3D', surface: '#1C1C1E', inverse: '#0E0E10', line: '#3A3A3C', signal: '#FF6B3D' }) },
  { id: 'academic-ink', name: '论文墨色', serif: true, example: 'ppt169_researchstudio_reel_paper', note: '受研究简报示例的墨色和一处蓝色启发。不使用论文版式里的机构名。', colors: light({ ink: '#1B2430', paper: '#F7F4EE', muted: '#5C6570', accent: '#1D4ED8', surface: '#E7EEF4', inverse: '#FFFFFF', line: '#D5D0C8', signal: '#1D4ED8' }) },
  { id: 'night-circuit', name: '夜航电路', serif: false, example: 'ppt169_uv_launch', note: '受夜间产品演示的深色界面和一处冷光启发。不使用该示例的名称、标志或路径图形。', colors: dark({ ink: '#E6EDF3', paper: '#0B1220', muted: '#9BA9BC', accent: '#4CC9F0', surface: '#131C2E', inverse: '#0B1220', line: '#243349', signal: '#FF8A3D' }) },
]

if (import.meta.main) main()
