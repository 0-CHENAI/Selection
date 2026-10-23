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
      expect(checkDeck(deck)).toEqual([])
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
  it('ships fourteen 12-page style decks', () => {
    const catalog = JSON.parse(read('styles/catalog.json')) as Record<string, { deck: string }>
    for (const id of styles) {
      expect(catalog[id]?.deck).toBe(`styles/${id}/deck.json`)
      const parsed = parseDeckSource(read(`styles/${id}/deck.json`))
      expect(parsed.issues).toEqual([])
      const deck = parsed.deck!
      expect(deck.pages).toHaveLength(12)
      expect(deck.canvas).toEqual({ width: 960, height: 540 })
      expect(deck.theme.id).toBe(id)
      expect(checkDeck(deck)).toEqual([])
      expect(read(`styles/${id}/design.md`)).toContain('Hugo He')
    }
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
    const deck = parseDeckSource(read('styles/academic-research/deck.json')).deck!
    expect(checkDeck(applyTheme(deck, JSON.parse(read('styles/themes/night-circuit.json')) as Theme))).toEqual([])
    const darkDeck = parseDeckSource(read('styles/product-launch/deck.json')).deck!
    expect(checkDeck(applyTheme(darkDeck, JSON.parse(read('styles/themes/jiangshan.json')) as Theme))).toEqual([])
  })
})
