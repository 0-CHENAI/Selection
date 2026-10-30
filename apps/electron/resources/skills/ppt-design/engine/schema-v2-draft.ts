/**
 * deck.json version 2 草案。阶段 04（#707）只把字段和迁移规则定下来。
 * 生产解析仍是 schema.ts 的 version 1：本文件不被 schema.ts 或 index.ts 引用。
 * 旧工程不改写。LinNai 拍板前不要把这些字段放进真实模板。
 */
import { DECK_FORMAT, DECK_VERSION, type Deck, type DeckElement, type DeckPage } from './types.ts'

export const DECK_VERSION_DRAFT = 2 as const

/** 已有字段够用、草案故意不再加一份的名字。 */
export const DECK_V2_REUSED_FIELDS = ['path', 'pathRule', 'gradient', 'pattern', 'shadow', 'arrow', 'notes'] as const

export const DECK_V2_DRAFT_FIELDS = {
  deck: ['source'],
  page: ['layoutRef', 'imageSlots'],
  element: ['group', 'crop', 'mask', 'link', 'runs', 'retained'],
} as const

export type DraftSource = {
  kind: 'import' | 'template-project' | 'authored'
  fileName?: string
  sha256?: string
}

export type DraftLayoutRef = {
  master?: string
  layout?: string
}

/** 与 dsh.template-images/v1 字段语义一致。schema 字符串保持原值，便于读写备注里的同一份 JSON。 */
export type ImageSlotContract = {
  schema: 'dsh.template-images/v1'
  layoutId: string
  pageRole: string
  style: {
    medium: string
    palette: string
    lighting: string
    tone: string
    textTreatment: string
    continuity: string
  }
  contentPolicy?: 'provided-facts-or-qualitative'
  slots: ImageSlot[]
}

export type ImageSlot = {
  elementId: string
  role: string
  contentSources: string[]
  sourcePolicy: 'contextual-scene' | 'provided-portrait' | 'native-graphic'
  subject: string
  composition: string
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
  reuseGroup: string
  maskElementIds: string[]
}

export type DraftCrop = { l: number; t: number; r: number; b: number }

export type DraftMask = {
  shape: 'rect' | 'roundRect' | 'ellipse' | 'path'
  path?: string
}

export type DraftTextRun = {
  text: string
  size?: number
  bold?: boolean
  italic?: boolean
  color?: string
}

export type DraftGroup = { id: string }

export type DraftRetained = { feature: string; message: string }

export type DraftElement = DeckElement & {
  group?: DraftGroup
  crop?: DraftCrop
  mask?: DraftMask
  link?: { href: string }
  runs?: DraftTextRun[]
  retained?: DraftRetained
}

export type DraftPage = Omit<DeckPage, 'elements'> & {
  layoutRef?: DraftLayoutRef
  imageSlots?: ImageSlotContract
  elements: DraftElement[]
}

export type DraftDeck = Omit<Deck, 'version' | 'pages'> & {
  version: typeof DECK_VERSION_DRAFT
  source?: DraftSource
  pages: DraftPage[]
}

export type ImageContractParse =
  | { status: 'absent' }
  | { status: 'ok'; contract: ImageSlotContract }
  | { status: 'invalid'; message: string }

const STYLE_KEYS = ['medium', 'palette', 'lighting', 'tone', 'textTreatment', 'continuity'] as const
const SLOT_KEYS = ['elementId', 'role', 'contentSources', 'sourcePolicy', 'subject', 'composition', 'aspectRatio', 'reuseGroup', 'maskElementIds'] as const
const CONTRACT_KEYS = ['schema', 'layoutId', 'pageRole', 'style', 'slots', 'contentPolicy'] as const
const ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4'])
const SOURCE_POLICIES = new Set(['contextual-scene', 'provided-portrait', 'native-graphic'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function knownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function plainText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
}

/**
 * 读备注里的图片槽合同。不是这份合同的备注返回 absent，调用方继续把它当普通备注。
 * elements 可选：给出时核对图片槽、文字来源和遮罩形状是否在本页。
 */
export function parseImageContract(notes: string | undefined, elements?: Array<{ id: string; type: string }>): ImageContractParse {
  if (typeof notes !== 'string' || !notes.trim().startsWith('{')) return { status: 'absent' }
  if (Buffer.byteLength(notes) > 64 * 1024) return { status: 'invalid', message: '单页图片槽合同超过 64 KB' }
  let value: unknown
  try { value = JSON.parse(notes) } catch { return notes.includes('dsh.template-images/v1') ? { status: 'invalid', message: '图片槽合同不是合法 JSON' } : { status: 'absent' } }
  if (!isRecord(value) || value.schema !== 'dsh.template-images/v1') return { status: 'absent' }
  if (!knownKeys(value, CONTRACT_KEYS)) return { status: 'invalid', message: '图片槽合同含有未支持字段' }
  if (value.contentPolicy !== undefined && value.contentPolicy !== 'provided-facts-or-qualitative') return { status: 'invalid', message: '图片槽内容来源策略无效' }
  if (!plainText(value.layoutId) || !plainText(value.pageRole)) return { status: 'invalid', message: '图片槽合同缺少版式或页面角色' }
  if (!isRecord(value.style) || !knownKeys(value.style, STYLE_KEYS) || STYLE_KEYS.some(key => !plainText(value.style?.[key]))) {
    return { status: 'invalid', message: '图片槽全局风格需要六项描述' }
  }
  if (!Array.isArray(value.slots) || value.slots.length > 16) return { status: 'invalid', message: '单页最多 16 个图片槽' }
  const seen = new Set<string>()
  const slots: ImageSlot[] = []
  for (const slot of value.slots) {
    if (!isRecord(slot) || !knownKeys(slot, SLOT_KEYS)) return { status: 'invalid', message: '图片槽字段无效' }
    if (!plainText(slot.elementId) || !plainText(slot.role) || !plainText(slot.subject) || !plainText(slot.composition) || !plainText(slot.reuseGroup)) {
      return { status: 'invalid', message: '图片槽文字无效' }
    }
    if (typeof slot.sourcePolicy !== 'string' || !SOURCE_POLICIES.has(slot.sourcePolicy)) return { status: 'invalid', message: '图片槽素材来源策略无效' }
    if (typeof slot.aspectRatio !== 'string' || !ASPECTS.has(slot.aspectRatio)) return { status: 'invalid', message: '图片槽比例无效' }
    if (!stringList(slot.contentSources) || !stringList(slot.maskElementIds)) return { status: 'invalid', message: '图片槽引用列表无效' }
    if (seen.has(slot.elementId)) return { status: 'invalid', message: '图片槽重复' }
    seen.add(slot.elementId)
    if (elements) {
      const picture = elements.find(item => item.id === slot.elementId)
      if (!picture || picture.type !== 'image') return { status: 'invalid', message: `找不到图片槽 ${slot.elementId}` }
      for (const id of slot.contentSources) {
        const source = elements.find(item => item.id === id)
        if (!source || source.type !== 'text') return { status: 'invalid', message: `图片槽文字来源 ${id} 不是文本` }
      }
      for (const id of slot.maskElementIds) {
        const mask = elements.find(item => item.id === id)
        if (!mask || mask.type !== 'shape') return { status: 'invalid', message: `图片槽遮罩 ${id} 不是形状` }
      }
    }
    slots.push({
      elementId: slot.elementId,
      role: slot.role,
      contentSources: [...slot.contentSources],
      sourcePolicy: slot.sourcePolicy as ImageSlot['sourcePolicy'],
      subject: slot.subject,
      composition: slot.composition,
      aspectRatio: slot.aspectRatio as ImageSlot['aspectRatio'],
      reuseGroup: slot.reuseGroup,
      maskElementIds: [...slot.maskElementIds],
    })
  }
  const style = value.style
  return {
    status: 'ok',
    contract: {
      schema: 'dsh.template-images/v1',
      layoutId: value.layoutId,
      pageRole: value.pageRole,
      style: {
        medium: style.medium as string,
        palette: style.palette as string,
        lighting: style.lighting as string,
        tone: style.tone as string,
        textTreatment: style.textTreatment as string,
        continuity: style.continuity as string,
      },
      contentPolicy: value.contentPolicy === 'provided-facts-or-qualitative' ? value.contentPolicy : undefined,
      slots,
    },
  }
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 24 && value.every(item => plainText(item))
}

/**
 * 从 version 1 工程做出草案视图，不修改入参。
 * 备注里已有合法图片槽合同时，复制到页级 imageSlots，备注原文保留。
 */
export function liftImageSlots(deck: Deck, source?: DraftSource): DraftDeck {
  const draft = structuredClone(deck) as DraftDeck
  draft.version = DECK_VERSION_DRAFT
  if (source) draft.source = structuredClone(source)
  draft.pages = draft.pages.map(page => {
    const parsed = parseImageContract(page.notes, page.elements.map(item => ({ id: item.id, type: item.type })))
    if (parsed.status !== 'ok') return page
    return { ...page, imageSlots: parsed.contract }
  })
  return draft
}

function elementBlocksDowngrade(element: DraftElement): string | null {
  if (element.group) return `元素 ${element.id} 带有 group，降回 version 1 会丢掉分组`
  if (element.crop) return `元素 ${element.id} 带有 crop，降回 version 1 会丢掉裁剪`
  if (element.mask) return `元素 ${element.id} 带有 mask，降回 version 1 会丢掉遮罩`
  if (element.link) return `元素 ${element.id} 带有 link，降回 version 1 会丢掉超链接`
  if (element.runs && element.runs.length > 0) return `元素 ${element.id} 带有 runs，降回 version 1 会丢掉分段样式`
  if (element.retained) return `元素 ${element.id} 带有 retained，降回 version 1 会丢掉保留对象`
  return null
}

/**
 * 只有草案字段为空，或图片槽已经完整留在备注 JSON 里，才允许降回 version 1。
 * 降级结果必须能被现行 parseDeckDocument 接受。
 */
export function downgradeDraft(draft: DraftDeck): { ok: true; deck: Deck } | { ok: false; reason: string } {
  if (draft.format !== DECK_FORMAT) return { ok: false, reason: 'format 不是 selection-deck' }
  if (draft.version !== DECK_VERSION_DRAFT && draft.version !== DECK_VERSION) return { ok: false, reason: 'version 不是 1 或草案 2' }
  if (draft.source) return { ok: false, reason: 'source 还在工程上，降回 version 1 会丢掉导入来源' }
  const pages: DeckPage[] = []
  for (const page of draft.pages) {
    if (page.layoutRef && (page.layoutRef.master || page.layoutRef.layout)) return { ok: false, reason: `页面 ${page.id} 带有 layoutRef，降回 version 1 会丢掉母版引用` }
    if (page.imageSlots) {
      const parsed = parseImageContract(page.notes)
      if (parsed.status !== 'ok' || JSON.stringify(parsed.contract) !== JSON.stringify(page.imageSlots)) {
        return { ok: false, reason: `页面 ${page.id} 的图片槽还没有写回备注，不能降回 version 1` }
      }
    }
    const elements: DeckElement[] = []
    for (const element of page.elements) {
      const blocked = elementBlocksDowngrade(element)
      if (blocked) return { ok: false, reason: blocked }
      const { group: _group, crop: _crop, mask: _mask, link: _link, runs: _runs, retained: _retained, ...rest } = element
      elements.push(rest)
    }
    const { layoutRef: _layoutRef, imageSlots: _imageSlots, ...pageRest } = page
    pages.push({ ...pageRest, elements })
  }
  const { source: _source, ...rest } = draft
  return { ok: true, deck: { ...rest, version: DECK_VERSION, pages } }
}
