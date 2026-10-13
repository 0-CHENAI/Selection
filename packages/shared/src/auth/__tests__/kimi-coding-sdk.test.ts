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

  it('Kimi Code keeps API-key auth too, so OAuth credentials must be sent as oauth (Bearer)', () => {
    // pi-agent passes Kimi OAuth tokens as `type: 'oauth'`; adapt-credential only
    // auto-upgrades api_key → oauth for OAuth-only providers.
    const provider = builtinProviders().find(p => p.id === KIMI_CODING_PROVIDER_ID)
    expect(provider!.auth.apiKey).toBeDefined()
  })
})
