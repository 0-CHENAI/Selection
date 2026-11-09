import { describe, expect, it } from 'bun:test'
import { proposeImageContract } from './image-slots.ts'
import { parseImageContract } from './schema-v2-draft.ts'
import { makePage, text } from '../styles/kit.ts'
import type { DeckElement } from './types.ts'

const style = {
  medium: '摄影', palette: '纸色', lighting: '日光', tone: '克制', textTreatment: '图片内文字数量为 0', continuity: '同一机位',
}

function contract(extra: Record<string, unknown> = {}, slotExtra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'dsh.template-images/v1',
    layoutId: 'evidence',
    pageRole: '证据',
    style,
    contentPolicy: 'provided-facts-or-qualitative',
    slots: [{
      elementId: 'shot', role: '场景', contentSources: ['title'], sourcePolicy: 'contextual-scene',
      subject: '产品', composition: '留白在上', aspectRatio: '16:9', reuseGroup: 'product', maskElementIds: ['mask'],
      ...slotExtra,
    }],
    ...extra,
  })
}

const elements = [
  { id: 'shot', type: 'image' },
  { id: 'title', type: 'text' },
  { id: 'mask', type: 'shape' },
]

describe('dsh.template-images/v1', () => {
  it('accepts a contract whose slots point at real elements', () => {
    const parsed = parseImageContract(contract(), elements)
    expect(parsed.status).toBe('ok')
    if (parsed.status === 'ok') expect(parsed.contract.slots).toHaveLength(1)
  })

  it('rejects ten illegal contracts with a readable reason', () => {
    const cases: Array<[string, string]> = [
      [contract({ extra: true }), '未支持字段'],
      [contract({ contentPolicy: 'invented' }), '内容来源'],
      [contract({ style: { ...style, tone: '' } }), '六项'],
      [JSON.stringify({ ...JSON.parse(contract()), slots: Array.from({ length: 17 }, (_, index) => ({ ...JSON.parse(contract()).slots[0], elementId: `s${index}` })) }), '16'],
      [JSON.stringify({ ...JSON.parse(contract()), slots: [JSON.parse(contract()).slots[0], JSON.parse(contract()).slots[0]] }), '重复'],
      [contract({}, { aspectRatio: '2:1' }), '比例'],
      [contract({}, { sourcePolicy: 'web' }), '来源策略'],
      [contract({}, { elementId: 'missing' }), '找不到图片槽'],
      [contract({}, { contentSources: ['shot'] }), '不是文本'],
      [contract({}, { maskElementIds: ['title'] }), '不是形状'],
    ]
    expect(cases).toHaveLength(10)
    for (const [notes, reason] of cases) {
      const parsed = parseImageContract(notes, elements)
      expect(parsed.status).toBe('invalid')
      if (parsed.status === 'invalid') expect(parsed.message).toContain(reason)
    }
    const huge = contract()
    expect(parseImageContract(`${huge}${' '.repeat(70 * 1024)}`).status).toBe('invalid')
  })

  it('proposes slots from pictures and leaves the page unchanged', () => {
    const picture: DeckElement = { id: 'shot', type: 'image', bounds: { x: 48, y: 120, w: 320, h: 180 }, src: 'assets/a.png', alt: '产品' }
    const page = makePage('p1', 'evidence', '证据', '$paper', [text('title', '结论', 48, 40, 400, 40, 24), picture], '讲者备注')
    const before = JSON.stringify(page)
    const proposed = proposeImageContract(page)
    expect(JSON.stringify(page)).toBe(before)
    expect(proposed?.slots[0]).toMatchObject({ elementId: 'shot', aspectRatio: '16:9', sourcePolicy: 'contextual-scene', contentSources: ['title'] })
    expect(proposeImageContract(makePage('empty', 'free', '空', '$paper', [text('title', '只有字', 48, 40, 200, 40, 18)], ''))).toBeUndefined()
  })
})
