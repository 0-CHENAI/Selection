import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { pptComposerAtomFamily, replacePptTemplate } from '../../atoms/ppt'
import { attachTrail, CARD_HEIGHT, CARD_WIDTH, centeredCardTop, centeredOverhangBottom, centeredOverhangTop, CHIP_HEIGHT, ROW_GAP, tiltExtent, VISUAL_GAP } from './geometry'
import { groupPptHistory } from './history'
import { sessionAtomFamily } from '../../atoms/sessions'
import type { Session } from '../../../shared/types'

describe('PPT composer selection', () => {
  it('replaces the selected template while retaining real request options', () => {
    const logo = { name: 'brand.png', mimeType: 'image/png', base64: 'aGVsbG8=' }
    const before = { templateId: 'first', themeId: 'theme', brandColor: '#123456', logo, aspectRatio: '4:3' as const, chartSkill: 'sample-charts' }
    expect(replacePptTemplate(before, 'second')).toEqual({ ...before, templateId: 'second' })
    expect(before.templateId).toBe('first')
    expect(replacePptTemplate(undefined, 'first')).toEqual({ templateId: 'first' })
  })
  it('isolates drafts and clears only the accepted composer', () => {
    const store = createStore()
    const first = pptComposerAtomFamily('ppt:test:first')
    const second = pptComposerAtomFamily('ppt:test:second')
    store.set(first, replacePptTemplate(undefined, 'first'))
    store.set(second, replacePptTemplate(undefined, 'other'))
    store.set(first, previous => replacePptTemplate(previous, 'replacement'))
    expect(store.get(first)?.templateId).toBe('replacement')
    expect(store.get(second)?.templateId).toBe('other')
    store.set(first, undefined)
    expect(store.get(first)).toBeUndefined()
    expect(store.get(second)?.templateId).toBe('other')
  })
  it('inherits persisted settings for replacement but honors explicit removal', () => {
    const store = createStore()
    const saved: Session = { id: 'saved-ppt', workspaceId: 'workspace', workspaceName: '', workMode: 'PRO', messages: [], lastMessageAt: 0, isProcessing: false,
      ppt: { templateId: 'first', themeId: 'tea-tasting', brandColor: '#123456', aspectRatio: '4:3' } }
    store.set(sessionAtomFamily(saved.id), saved)
    const composer = pptComposerAtomFamily(saved.id)
    expect(store.get(composer)).toEqual(saved.ppt)
    store.set(composer, previous => replacePptTemplate(previous, 'replacement'))
    expect(store.get(composer)).toEqual({ ...saved.ppt, templateId: 'replacement' })
    store.set(composer, null)
    expect(store.get(composer)).toBeNull()
    store.set(sessionAtomFamily(saved.id), { ...saved, ppt: { templateId: 'updated-server-template' } })
    expect(store.get(composer)).toBeNull()
  })
})
describe('PPT history groups', () => {
  it('splits today, this week and earlier from Monday', () => {
    const now = new Date(2026, 9, 21, 15, 0, 0).getTime()
    const day = 86_400_000
    const grouped = groupPptHistory([
      { id: 'today', lastMessageAt: now },
      { id: 'monday', lastMessageAt: now - 2 * day },
      { id: 'sunday', createdAt: now - 3 * day },
    ], now)
    expect(grouped.recent.map(item => item.id)).toEqual(['today'])
    expect(grouped.thisWeek.map(item => item.id)).toEqual(['monday'])
    expect(grouped.earlier.map(item => item.id)).toEqual(['sunday'])
  })
})
describe('attachment painted geometry', () => {
  it('reserves fan, hover and both controls before the next attachment', () => {
    const extent = tiltExtent(CARD_WIDTH)
    const nextChipLeft = CARD_WIDTH + attachTrail() + ROW_GAP
    expect(nextChipLeft - extent.right).toBeGreaterThanOrEqual(VISUAL_GAP)
    expect(nextChipLeft - extent.right).toBeLessThan(VISUAL_GAP + 1)
    expect(extent.overhangRight).toBeGreaterThan(12)
    expect(extent.top).toBeLessThan(-8)
    expect(extent.bottom).toBeGreaterThan(CARD_HEIGHT)
    expect(20 + extent.top).toBeGreaterThanOrEqual(0)
    expect(attachTrail()).toBeGreaterThanOrEqual(20)
    expect(attachTrail()).toBeLessThan(30)
  })
  it('centers the rotated cover on the chip instead of the fan and control box', () => {
    const top = centeredCardTop()
    const coverCenter = top + CARD_HEIGHT / 2
    const chipCenter = CHIP_HEIGHT / 2
    expect(Math.abs(coverCenter - chipCenter)).toBeLessThanOrEqual(2)
    expect(centeredOverhangTop()).toBeLessThanOrEqual(20)
    const below = centeredOverhangBottom()
    expect(below).toBeGreaterThan(0)
    expect(Math.max(12, Math.ceil(below) + 2)).toBeGreaterThan(below)
  })
  it('scales clearance rather than hard-coding a gap for one width', () => {
    for (const width of [76, 92, 124, 180]) {
      const extent = tiltExtent(width)
      expect(width + attachTrail(width) + ROW_GAP - extent.right).toBeGreaterThanOrEqual(VISUAL_GAP)
      expect(extent.left).toBeLessThan(0)
      expect(extent.bottom).toBeGreaterThan(width * 9 / 16)
    }
  })
})
