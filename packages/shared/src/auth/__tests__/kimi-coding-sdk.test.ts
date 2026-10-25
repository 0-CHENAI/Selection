import { describe, expect, it } from 'bun:test'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { KIMI_CODING_PROVIDER_ID } from '../kimi-coding-sdk.ts'

// Kimi Code sign-in delegates the whole OAuth protocol to the Pi SDK. Guard
// against an SDK upgrade silently dropping or renaming that provider.
describe('kimi-coding-sdk', () => {
  it('Pi SDK exposes an OAuth flow for the Kimi Code provider', () => {
    const provider = builtinProviders().find(p => p.id === KIMI_CODING_PROVIDER_ID)
    expect(provider).toBeDefined()
    expect(provider!.auth.oauth).toBeDefined()
    expect(typeof provider!.auth.oauth!.login).toBe('function')
    expect(typeof provider!.auth.oauth!.refresh).toBe('function')
  })

  it('Kimi Code keeps API-key auth too, so OAuth credentials must be sent as oauth', () => {
    // pi-agent passes Kimi OAuth tokens as `type: 'oauth'`; adapt-credential only
    // auto-upgrades api_key → oauth for OAuth-only providers. Chat Completions
    // sends Bearer for both shapes; oauth is what calls `toAuth` and keeps
    // refresh on the main process.
    const provider = builtinProviders().find(p => p.id === KIMI_CODING_PROVIDER_ID)
    expect(provider!.auth.apiKey).toBeDefined()
  })

  it('Kimi Code uses Chat Completions at api.kimi.com/coding/v1 and does not list K3.1 yet', () => {
    const provider = builtinProviders().find(p => p.id === KIMI_CODING_PROVIDER_ID)
    const models = provider!.getModels()
    const ids = models.map(model => model.id)
    expect(ids).toEqual(expect.arrayContaining(['k3', 'k3-256k', 'kimi-for-coding', 'kimi-for-coding-highspeed']))
    // Upstream earendil-works/pi#11355 is still open. Do not invent K3.1 entries.
    expect(ids).not.toContain('k3.1-pro')
    expect(ids).not.toContain('k3.1-pro-highspeed')
    for (const model of models) {
      expect(model.api).toBe('openai-completions')
      expect(model.baseUrl).toBe('https://api.kimi.com/coding/v1')
    }
    const k3 = models.find(model => model.id === 'k3')
    expect(k3?.compat).toMatchObject({
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      thinkingFormat: 'openai',
      maxTokensField: 'max_tokens',
      requiresReasoningContentOnAssistantMessages: true,
    })
  })
})
