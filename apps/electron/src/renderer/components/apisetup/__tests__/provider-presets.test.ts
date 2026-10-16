import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { buildPiApiKeyModels } from '../pi-model-submission'
import {
  ORDER_APP_ICON_SLUG,
  SELECTION_APP_ICON_SLUG,
  USED_LOBE_ICON_SLUGS,
  getPresetsForProvider,
  presetBrandSlug,
  presetMonogram,
  sortNamedPresets,
} from '../provider-presets'

const require = createRequire(import.meta.url)
const iconsDir = join(dirname(require.resolve('@lobehub/icons-static-svg/package.json')), 'icons')

describe('provider preset order', () => {
  it('sorts API key presets by name without regard to case', () => {
    const labels = getPresetsForProvider('pi_api_key').map((preset) => preset.label)
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }))
    expect(labels).toEqual(sorted)
    expect(labels.indexOf('Azure OpenAI')).toBeLessThan(labels.indexOf('DeepSeek'))
    expect(labels.indexOf('DeepSeek')).toBeLessThan(labels.indexOf('Google AI Studio'))
    expect(labels.indexOf('OpenAI')).toBeLessThan(labels.indexOf('OpenAI EU'))
    expect(labels.indexOf('OpenAI EU')).toBeLessThan(labels.indexOf('OpenAI US'))
    expect(labels.indexOf('OpenAI US')).toBeLessThan(labels.indexOf('OpenRouter'))
    expect(labels.indexOf('OpenRouter')).toBeLessThan(labels.indexOf('ORDER (OpenAI)'))
    expect(labels.indexOf('xAI (Grok)')).toBeLessThan(labels.indexOf('z.ai (GLM)'))
    expect(labels.indexOf('Minimax CN')).toBeLessThan(labels.indexOf('Minimax Global'))
  })

  it('sortNamedPresets is case-insensitive and keeps a stable key order for ties', () => {
    expect(sortNamedPresets([
      { key: 'b', label: 'zeta' },
      { key: 'a', label: 'Alpha' },
      { key: 'c', label: 'alpha' },
    ]).map((preset) => preset.key)).toEqual(['a', 'c', 'b'])
  })

  it('uses one letter style when LobeHub has no mark', () => {
    expect(presetMonogram('Manifest')).toBe('M')
    expect(presetMonogram('自定义')).toBe('自')
    expect(presetMonogram('')).toBe('?')
  })
})

describe('LobeHub preset icons', () => {
  const letterFallback = new Set(['manifest'])
  const selectionIconPath = new URL('../../../assets/selection-icon.svg', import.meta.url)
  const orderIconPath = new URL('../../../assets/order-icon.svg', import.meta.url)

  it('uses the bundled Selection mark for Custom and Selection Backend', () => {
    expect(presetBrandSlug('custom')).toBe(SELECTION_APP_ICON_SLUG)
    expect(presetBrandSlug('pi')).toBe(SELECTION_APP_ICON_SLUG)
    expect(existsSync(selectionIconPath)).toBe(true)
    const markSource = readFileSync(new URL('../PresetBrandMark.tsx', import.meta.url), 'utf8')
    expect(markSource).toContain('selection-icon.svg')
    expect(markSource).toContain('bg-current')
  })

  it('uses the filled ORDER mark instead of a letter or the retired rings', () => {
    expect(presetBrandSlug('order-openai')).toBe(ORDER_APP_ICON_SLUG)
    const svg = readFileSync(orderIconPath, 'utf8')
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).toContain('fill="currentColor"')
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain('M22.971 11.971')
    expect(svg).toContain('3.115 4.657Z')
    expect(svg).not.toContain('<circle')
    expect(svg).not.toContain('<ellipse')
    expect(svg).not.toContain('stroke-width')
    const markSource = readFileSync(new URL('../PresetBrandMark.tsx', import.meta.url), 'utf8')
    expect(markSource).toContain('order-icon.svg')
  })

  it('maps every dropdown preset to a real LobeHub svg, the Selection mark, or the letter placeholder', () => {
    const presets = [
      ...getPresetsForProvider('pi_api_key'),
      ...getPresetsForProvider('pi'),
      ...getPresetsForProvider('anthropic'),
      ...getPresetsForProvider('google'),
      ...getPresetsForProvider('openai'),
    ]
    const markSource = readFileSync(new URL('../PresetBrandMark.tsx', import.meta.url), 'utf8')
    expect(markSource).not.toContain("from '@lobehub/icons'")
    expect(markSource).not.toContain('import *')

    for (const preset of presets) {
      const slug = presetBrandSlug(preset.key)
      if (letterFallback.has(preset.key)) {
        expect(slug).toBeNull()
        continue
      }
      if (slug === SELECTION_APP_ICON_SLUG) {
        expect(existsSync(selectionIconPath)).toBe(true)
        expect(markSource).toContain('selection-icon.svg')
        continue
      }
      if (slug === ORDER_APP_ICON_SLUG) {
        expect(existsSync(orderIconPath)).toBe(true)
        expect(readFileSync(orderIconPath, 'utf8')).toContain('fill-rule="evenodd"')
        expect(markSource).toContain('order-icon.svg')
        continue
      }
      if (!slug) throw new Error(`missing LobeHub icon for ${preset.key}`)
      expect(USED_LOBE_ICON_SLUGS).toContain(slug)
      expect(existsSync(join(iconsDir, `${slug}.svg`))).toBe(true)
      expect(markSource).toContain(`icons/${slug}.svg`)
    }

    expect(presetBrandSlug('pi_chatgpt_oauth')).toBe('openai')
    expect(presetBrandSlug('pi_copilot_oauth')).toBe('githubcopilot')
    expect(presetBrandSlug('pi_kimi_oauth')).toBe('kimi')
    expect(markSource).toContain('icons/githubcopilot.svg')
  })
})

describe('buildPiApiKeyModels', () => {
  it('keeps catalog windows, fills known presets, and falls back safely', () => {
    expect(buildPiApiKeyModels(
      ['deepseek-v4-flash', 'deepseek-v4-pro', 'local-model'],
      [
        { id: 'deepseek-v4-flash', name: 'Flash', contextWindow: 128000 },
        { id: 'deepseek-v4-pro', name: 'Pro' },
        { id: 'local-model', name: 'Local' },
      ],
      { contextWindows: { 'local-model': 262144 } },
    )).toEqual([
      { id: 'deepseek-v4-flash', contextWindow: 128000 },
      { id: 'deepseek-v4-pro', contextWindow: 1_000_000, maxTokens: 384000 },
      { id: 'local-model', contextWindow: 262144 },
    ])
  })
})
