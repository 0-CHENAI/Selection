import { describe, expect, it } from 'bun:test'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { argumentLayouts, buildArgumentPage } from './argument-layouts.ts'
import { blockingIssues, checkDeck, formatNeedsRevision, isPlaceholderImageSrc, LAYOUT_REPETITION_RUN } from './check.ts'
import { exportDeck } from './export-pptx.ts'
import { chart, fixtureTheme, makeDeck, makePage, text } from '../styles/kit.ts'
import type { DeckElement, DeckPage, ImageSlotContract } from './types.ts'

function page(id: string, layout: string, elements: DeckElement[] = [text('title', '结论', 48, 40, 400, 48, 24, { bold: true })]): DeckPage {
  return makePage(id, layout, id, '$paper', elements, '')
}

function deckOf(layouts: string[]): ReturnType<typeof makeDeck> {
  return makeDeck('预检', fixtureTheme, layouts.map((layout, index) => page(`p${index + 1}`, layout)))
}

const style: ImageSlotContract['style'] = {
  medium: '摄影',
  palette: '纸色与墨色',
  lighting: '均匀日光',
  tone: '克制',
  textTreatment: '图片内文字数量为 0',
  continuity: '同一机位语言',
}

describe('PPT preflight parity', () => {
  it('warns when three consecutive pages share a layout and clears when one changes', () => {
    expect(LAYOUT_REPETITION_RUN).toBe(3)
    const repeated = checkDeck(deckOf(['trend', 'trend', 'trend']))
    const warning = repeated.find(item => item.code === 'layout_repetition')
    expect(warning?.severity).toBe('warning')
    expect(warning?.pageId).toBe('p1')
    expect(blockingIssues(repeated)).toEqual([])
    expect(checkDeck(deckOf(['trend', 'matrix', 'trend'])).some(item => item.code === 'layout_repetition')).toBe(false)
    expect(checkDeck(deckOf(['trend', 'trend'])).some(item => item.code === 'layout_repetition')).toBe(false)
    expect(checkDeck(deckOf(['free', 'free', 'free'])).some(item => item.code === 'layout_repetition')).toBe(false)
  })

  it('does not treat the 14 argument layouts as missing just because repetition is checked', () => {
    expect(argumentLayouts).toHaveLength(14)
    const pages = argumentLayouts.map(layout => buildArgumentPage(layout.id))
    const issues = checkDeck(makeDeck('论证', fixtureTheme, pages))
    expect(issues.some(item => item.code === 'layout_repetition')).toBe(false)
    expect(issues.some(item => item.message.includes('缺少元素'))).toBe(false)
  })

  it('warns on a cover without a focal image or a dominant title', () => {
    const quiet = makeDeck('封面', fixtureTheme, [makePage('cover', 'cover', '封面', '$paper', [
      text('a', '一', 48, 80, 200, 28, 16),
      text('b', '二', 48, 120, 200, 28, 18),
      text('c', '三', 48, 160, 200, 28, 20),
    ], '')])
    expect(checkDeck(quiet).some(item => item.code === 'cover_focus' && item.severity === 'warning')).toBe(true)
    const loud = makeDeck('封面', fixtureTheme, [makePage('cover', 'cover', '封面', '$paper', [
      text('a', '一', 48, 80, 200, 28, 16),
      text('b', '二', 48, 120, 200, 28, 18),
      text('title', '判断', 48, 160, 700, 80, 60, { bold: true }),
    ], '')])
    expect(checkDeck(loud).some(item => item.code === 'cover_focus')).toBe(false)
  })

  it('rejects a chart whose series is shorter than its categories and allows export after the column is filled', async () => {
    const broken = makeDeck('图表', fixtureTheme, [makePage('p1', 'trend', '趋势', '$paper', [
      text('title', '趋势', 48, 40, 400, 48, 24, { bold: true }),
      chart('bars', 48, 120, 480, 280, { kind: 'column', categories: ['甲', '乙'], series: [{ name: '数量', values: [2] }], colors: ['$accent'] }),
    ], '')])
    const issues = checkDeck(broken)
    expect(issues.some(item => item.code === 'chart_data' && item.elementId === 'bars' && item.severity !== 'warning')).toBe(true)
    const rendered = formatNeedsRevision('deck.json', issues)
    expect(rendered).toContain('needs_revision')
    expect(rendered).toContain('页 p1')
    expect(rendered).toContain('元素 bars')
    const dir = mkdtempSync(join(tmpdir(), 'ppt-preflight-'))
    const blocked = await exportDeck(broken, join(dir, 'blocked.pptx'), { platform: 'linux' })
    expect(blocked.status).toBe('needs_revision')
    expect(blocked.pptx).toBeUndefined()
    expect(existsSync(join(dir, 'blocked.pptx'))).toBe(false)
    const fixed = makeDeck('图表', fixtureTheme, [makePage('p1', 'trend', '趋势', '$paper', [
      text('title', '趋势', 48, 40, 400, 48, 24, { bold: true }),
      chart('bars', 48, 120, 480, 280, { kind: 'column', categories: ['甲', '乙'], series: [{ name: '数量', values: [2, 5] }], colors: ['$accent'] }),
    ], '')])
    const exported = await exportDeck(fixed, join(dir, 'fixed.pptx'), { platform: 'linux' })
    expect(exported.status).toBe('ok')
    expect(exported.pptx).toBeTruthy()
  })

  it('rejects a non-pie series color list and a remote or missing slot image', () => {
    const picture: DeckElement = { id: 'shot', type: 'image', role: 'content', bounds: { x: 48, y: 120, w: 320, h: 180 }, src: 'https://example.test/a.png', alt: '产品' }
    const deck = makeDeck('图', fixtureTheme, [makePage('p1', 'trend', '趋势', '$paper', [
      text('title', '趋势', 48, 40, 400, 48, 24, { bold: true }),
      chart('bars', 48, 120, 200, 120, { kind: 'column', categories: ['甲'], series: [{ name: '数量', values: [2] }], colors: ['red'] }),
      picture,
    ], '')])
    const codes = checkDeck(deck).map(item => item.code)
    expect(codes).toContain('chart_series_color')
    expect(codes).toContain('remote_image')
    const slot = deck.pages[0]!
    slot.imageSlots = {
      schema: 'dsh.template-images/v1',
      layoutId: 'trend',
      pageRole: 'evidence',
      style,
      contentPolicy: 'provided-facts-or-qualitative',
      slots: [{
        elementId: 'shot', role: 'scene', contentSources: ['title'], sourcePolicy: 'contextual-scene',
        subject: '产品', composition: '留白在上方', aspectRatio: '16:9', reuseGroup: 'product', maskElementIds: [],
      }],
    }
    picture.src = ''
    expect(checkDeck(deck).some(item => item.code === 'missing_asset' && item.severity !== 'warning')).toBe(true)
    picture.src = 'selection-placeholder-product.png'
    picture.bounds = { x: 48, y: 120, w: 200, h: 200 }
    const fitted = checkDeck(deck)
    expect(fitted.some(item => item.code === 'missing_asset' && item.severity === 'warning')).toBe(true)
    expect(fitted.some(item => item.code === 'missing_asset' && item.severity !== 'warning')).toBe(false)
    expect(fitted.some(item => item.code === 'image_fit')).toBe(true)
    expect(isPlaceholderImageSrc(picture.src)).toBe(true)
    picture.bounds = { x: 48, y: 120, w: 320, h: 180 }
    picture.src = 'assets/product.png'
    picture.crop = { l: 0.4, t: 0.4, r: 0.3, b: 0.3 }
    const cropped = checkDeck(deck, { assetExists: () => false })
    expect(cropped.some(item => item.code === 'image_crop')).toBe(true)
    expect(cropped.some(item => item.code === 'missing_asset' && item.severity !== 'warning')).toBe(true)
    picture.crop = { l: 0, t: 0, r: 0, b: 0 }
    expect(checkDeck(deck, { assetExists: () => true }).some(item => item.code === 'missing_asset' || item.code === 'image_fit' || item.code === 'image_crop')).toBe(false)
  })

  it('lets a layout-repetition warning through export', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppt-warn-'))
    const result = await exportDeck(deckOf(['trend', 'trend', 'trend']), join(dir, 'warn.pptx'), { platform: 'linux' })
    expect(result.status).toBe('ok')
    expect(result.issues.some(item => item.code === 'layout_repetition')).toBe(true)
    expect(existsSync(result.pptx!)).toBe(true)
  })
})
