import { describe, expect, it } from 'bun:test'
import { getProviderIcon, providerIcons } from '../provider-icons.ts'

describe('getProviderIcon', () => {
  it('uses the bundled ORDER mark for the ORDER gateway', () => {
    expect(getProviderIcon('pi_compat', 'https://order.ai.jxepdi.top', 'anthropic')).toBe(providerIcons.order)
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
