import { describe, expect, it } from 'bun:test'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { XAI_PROVIDER_ID } from '../xai-sdk.ts'

describe('xai-sdk', () => {
  it('Pi SDK exposes subscription OAuth with login and refresh for xAI', () => {
    const provider = builtinProviders().find(p => p.id === XAI_PROVIDER_ID)
    expect(provider).toBeDefined()
    expect(provider!.auth.oauth).toBeDefined()
    expect(provider!.auth.oauth!.isSubscription).toBe(true)
    expect(typeof provider!.auth.oauth!.login).toBe('function')
    expect(typeof provider!.auth.oauth!.refresh).toBe('function')
  })

  it('keeps API-key auth alongside OAuth, so subscription tokens retain oauth semantics', () => {
    const provider = builtinProviders().find(p => p.id === XAI_PROVIDER_ID)
    expect(provider!.auth.apiKey).toBeDefined()
  })

  it('uses the official xAI Responses endpoint and Grok catalog', () => {
    const provider = builtinProviders().find(p => p.id === XAI_PROVIDER_ID)
    const models = provider!.getModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models.map(model => model.id)).toContain('grok-4.3')
    for (const model of models) {
      expect(model.api).toBe('openai-responses')
      expect(model.baseUrl).toBe('https://api.x.ai/v1')
    }
  })
})
