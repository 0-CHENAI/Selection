import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getProviderIcon, providerIcons, resolveConnectionBrandIcon } from '../provider-icons.ts'

describe('getProviderIcon', () => {
  it('uses the bundled ORDER mark for the ORDER gateway', () => {
    expect(getProviderIcon('pi_compat', 'https://order.ai.jxepdi.top', 'anthropic')).toBe(providerIcons.order)
  })

  it('draws the filled ORDER mark beside an ORDER connection instead of dropping it', () => {
    const brand = resolveConnectionBrandIcon({
      providerType: 'pi_compat',
      baseUrl: 'https://order.ai.jxepdi.top/v1',
      piAuthProvider: 'openai',
    })
    expect(brand.kind).toBe('order')
    expect(brand.src).toBe(providerIcons.order)

    const savedAsPi = resolveConnectionBrandIcon({
      providerType: 'pi',
      baseUrl: 'https://order.ai.jxepdi.top/v1',
      piAuthProvider: 'openai',
    })
    expect(savedAsPi.kind).toBe('order')

    const iconSource = readFileSync(new URL('../../components/icons/ConnectionIcon.tsx', import.meta.url), 'utf8')
    const iconModule = readFileSync(new URL('../provider-icons.ts', import.meta.url), 'utf8')
    const mark = readFileSync(new URL('../../assets/order-icon.svg', import.meta.url), 'utf8')
    expect(iconSource).toContain('resolveConnectionBrandIcon')
    expect(iconSource).toContain('order-icon.svg')
    expect(iconSource).not.toContain('return null')
    expect(iconModule).toContain("from '@/assets/order-icon.svg'")
    expect(iconModule).not.toContain('provider-icons/order.svg')
    expect(mark).toContain('fill-rule="evenodd"')
    expect(mark).not.toContain('<circle')
  })

  it('uses bundled SVGs for DeepSeek / Groq / xAI instead of remote favicons', () => {
    expect(getProviderIcon('pi', null, 'deepseek')).toBe(providerIcons.deepseek)
    expect(getProviderIcon('pi', null, 'groq')).toBe(providerIcons.groq)
    expect(getProviderIcon('pi', null, 'xai')).toBe(providerIcons.xai)
    expect(getProviderIcon('pi', null, 'cerebras')).toBe(providerIcons.cerebras)
    expect(getProviderIcon('pi', null, 'zai')).toBe(providerIcons.zai)
  })

  it('does not return Google Favicon URLs', () => {
    for (const provider of ['deepseek', 'groq', 'xai', 'cerebras', 'zai'] as const) {
      const icon = getProviderIcon('pi', null, provider)
      expect(icon).toBeTruthy()
      expect(String(icon)).not.toContain('gstatic.com')
    }
  })

  it('maps both Moonshot API regions to the bundled Kimi icon', () => {
    expect(getProviderIcon('pi', null, 'moonshotai')).toBe(providerIcons.kimi)
    expect(getProviderIcon('pi', null, 'moonshotai-cn')).toBe(providerIcons.kimi)
    expect(getProviderIcon('pi_compat', 'https://api.moonshot.cn/v1')).toBe(providerIcons.kimi)
  })
})
