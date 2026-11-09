import { describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { checkDeck } from './check.ts'
import { exportDeck } from './export-pptx.ts'
import { parseDeckSource } from './schema.ts'
import { applyTheme, checkTheme, generateBrandTheme } from './theme.ts'
import type { Theme } from './types.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const layouts: Record<string, { pages: number; width: number; height: number }> = {
  editorial_bleed: { pages: 10, width: 960, height: 540 },
  moments_square: { pages: 8, width: 810, height: 810 },
  presentation_core: { pages: 20, width: 960, height: 540 },
  presentation_core_43: { pages: 16, width: 768, height: 576 },
  report_core: { pages: 13, width: 960, height: 540 },
  story_vertical: { pages: 9, width: 810, height: 1440 },
  xiaohongshu_post: { pages: 10, width: 931.5, height: 1245 },
}

const styles = [
  'academic-research', 'consulting-decision', 'creative-pitch', 'duty-manual', 'incident-postmortem',
  'investor-pitch', 'mbb-consulting', 'narrative-keynote', 'operating-review', 'product-launch',
  'science-explainer', 'solution-proposal', 'technical-deepdive', 'workshop-teaching',
]

describe('ppt-master layouts', () => {
  it('keeps seven structural decks on their own canvases', () => {
    const catalog = JSON.parse(read('layouts/catalog.json')) as Record<string, { pages: number }>
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(layouts).sort())
    for (const [id, expectCanvas] of Object.entries(layouts)) {
      const parsed = parseDeckSource(read(`layouts/${id}/deck.json`))
      expect(parsed.issues).toEqual([])
      const deck = parsed.deck!
      expect(deck.pages).toHaveLength(expectCanvas.pages)
      expect(catalog[id]?.pages).toBe(expectCanvas.pages)
      expect(deck.canvas).toEqual({ width: expectCanvas.width, height: expectCanvas.height })
      // 结构版式本身就带空图片框（参考页），成稿用不用由图片规则决定。
      expect(checkDeck(deck).filter(item => item.code !== 'empty_picture_slot')).toEqual([])
      expect(read(`layouts/${id}/design.md`)).toContain('960')
      expect(read(`layouts/${id}/design.md`)).toContain('Hugo He')
    }
  })

  it('exports a square deck at a different slide size', async () => {
    const deck = parseDeckSource(read('layouts/moments_square/deck.json')).deck!
    const dir = join(tmpdir(), `pm-moments-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const out = join(dir, 'moments.pptx')
    const result = await exportDeck(deck, out, { platform: 'linux' })
    expect(result.status).toBe('ok')
    const zip = await JSZip.loadAsync(readFileSync(out))
    const presentation = await zip.file('ppt/presentation.xml')!.async('string')
    expect(presentation).toContain('cy="10287000"')
    expect(presentation).not.toContain('cy="6858000"')
  })
})

describe('ppt-master styles and themes', () => {
  it('points each style at a real example', () => {
    const catalog = JSON.parse(read('styles/catalog.json')) as Record<string, {
      deck?: string
      examples?: string[]
      excludedExample?: string
      reason?: string
      excluded?: boolean
    }>
    const dsh = Object.keys(catalog).filter(id => id.startsWith('dsh-')).sort()
    expect(dsh).toEqual([
      'dsh-blue-professional',
      'dsh-broadside',
      'dsh-cartesian',
      'dsh-course-workshop',
      'dsh-editorial-forest',
      'dsh-editorial-notebook',
      'dsh-engineering-blueprint',
      'dsh-monochrome',
      'dsh-neo-grid-bold',
      'dsh-playful',
      'dsh-sakura-chroma',
      'dsh-signal',
      'dsh-soft-editorial',
    ])
    for (const id of styles) {
      expect(read(`styles/${id}/design.md`)).toContain('Hugo He')
      const entry = catalog[id]
      expect(entry).toBeTruthy()
      expect(entry?.deck?.startsWith('styles/examples/') || entry?.deck?.startsWith('styles/_archive/')).toBe(true)
      expect(entry?.examples?.length).toBeGreaterThan(0)
      const parsed = parseDeckSource(read(entry!.deck!))
      expect(parsed.issues).toEqual([])
      expect(checkDeck(parsed.deck!)).toEqual([])
      expect(parsed.deck!.profile).toBe('example')
    }
    expect(catalog['incident-postmortem']?.examples?.[0]).toBe('ppt169_cloudflare_outage_postmortem')
    expect(catalog['product-launch']?.examples?.[0]).toBe('ppt169_uv_launch')
    expect(catalog['operating-review']?.examples).toEqual([
      'ppt169_apple_fy2025_review',
      'ppt169_china_telecom_2025',
      'ppt169_china_rail_2024_zh',
      'ppt169_china_rail_2024_zh_sonnet',
    ])
    expect(catalog['operating-review']?.deck).toBe('styles/examples/ppt169_apple_fy2025_review/deck.json')
  })

  it('keeps every converted example deck inside the checker', () => {
    const catalog = JSON.parse(read('styles/catalog.json')) as Record<string, { deck?: string; excluded?: boolean; canvas?: string; category?: string }>
    const examples = Object.entries(catalog).filter(([id, entry]) => id.startsWith('ppt') || id.startsWith('a4_') || id.startsWith('moments_') || id.startsWith('story_') || id.startsWith('xiaohongshu') || id.startsWith('wechat') || id.startsWith('banner_') || id.startsWith('custom_'))
    expect(examples.length).toBe(70)
    const converted = examples.filter(([, entry]) => entry.deck && !entry.excluded)
    expect(converted.length).toBe(70)
    for (const [, entry] of converted) {
      expect(['商务', '咨询', '学术', '教学', '技术', '创意', '社媒', '事故复盘', '经营复盘', '产品发布']).toContain(entry.category)
      const parsed = parseDeckSource(read(entry.deck!))
      expect(parsed.issues).toEqual([])
      expect(parsed.deck!.pages.length).toBeGreaterThan(0)
      expect(checkDeck(parsed.deck!)).toEqual([])
    }
    const byId = Object.fromEntries(examples)
    expect(byId.ppt169_cloudflare_outage_postmortem?.category).toBe('事故复盘')
    expect(byId.ppt169_apple_fy2025_review?.category).toBe('经营复盘')
    expect(byId.ppt169_china_telecom_2025?.category).toBe('经营复盘')
    expect(byId.ppt169_uv_launch?.category).toBe('产品发布')
    expect(byId.moments_nine_heritage_goods?.category).toBe('社媒')
    expect(byId.ppt169_china_rail_2024_zh?.category).toBe('商务')
    expect(byId.ppt169_china_rail_2024_zh_sonnet?.category).toBe('商务')
    expect(byId.ppt169_jilin_geohazard_rules_beautify?.category).toBe('商务')
    expect(byId.ppt169_telford_feedback_2023_24_quick?.category).toBe('商务')
    expect(byId.ppt169_telford_feedback_2023_24_quick?.canvas).toBe('16:9')
  })

  it('checks contrast for every named theme and a user brand', () => {
    const catalog = JSON.parse(read('styles/themes/catalog.json')) as Record<string, { file: string }>
    expect(Object.keys(catalog)).toHaveLength(12)
    for (const entry of Object.values(catalog)) {
      const theme = JSON.parse(read(entry.file)) as Theme
      expect(checkTheme(theme)).toEqual([])
    }
    const darkGreen = generateBrandTheme({
      id: 'night-brand',
      name: '夜航',
      primary: '#0E3B2E',
      secondary: '#F6E27A',
      logo: 'brand/mark.png',
    })
    expect(darkGreen.logo).toBe('brand/mark.png')
    expect(checkTheme(darkGreen)).toEqual([])
    const lightYellow = generateBrandTheme({
      id: 'sand-brand',
      name: '浅黄',
      primary: '#F6E27A',
      secondary: '#0E3B2E',
    })
    expect(lightYellow.logo).toBeUndefined()
    expect(checkTheme(lightYellow)).toEqual([])
    const candy = generateBrandTheme({
      id: 'candy-brand',
      name: '糖',
      primary: '#1A1A2E',
      secondary: '#FF3DA5',
    })
    expect(checkTheme(candy)).toEqual([])
    const deck = parseDeckSource(read('layouts/editorial_bleed/deck.json')).deck!
    expect(checkDeck(applyTheme(deck, JSON.parse(read('styles/themes/night-circuit.json')) as Theme)).filter(item => item.code !== 'empty_picture_slot')).toEqual([])
    const report = parseDeckSource(read('layouts/report_core/deck.json')).deck!
    expect(checkDeck(applyTheme(report, JSON.parse(read('styles/themes/jiangshan.json')) as Theme))).toEqual([])
  })
})
