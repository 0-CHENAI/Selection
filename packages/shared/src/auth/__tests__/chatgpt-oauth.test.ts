import { describe, expect, it } from 'bun:test'
import { CHATGPT_OAUTH_CONFIG } from '../chatgpt-oauth-config'
import { prepareChatGptOAuth, readChatGptPlanDisplayName } from '../chatgpt-oauth'

function tokenWithPlan(plan: unknown): string {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_plan_type: plan },
  })).toString('base64url')
  return `header.${payload}.signature`
}

describe('prepareChatGptOAuth', () => {
  it('sends originator=pi and keeps the existing Codex public-client scope', () => {
    const prepared = prepareChatGptOAuth()
    const url = new URL(prepared.authUrl)

    expect(url.origin + url.pathname).toBe(CHATGPT_OAUTH_CONFIG.AUTH_URL)
    expect(url.searchParams.get('client_id')).toBe(CHATGPT_OAUTH_CONFIG.CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe(CHATGPT_OAUTH_CONFIG.REDIRECT_URI)
    expect(url.searchParams.get('scope')).toBe('openid profile email offline_access')
    expect(url.searchParams.get('originator')).toBe('pi')
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(url.searchParams.get('id_token_add_organizations')).toBe('true')
    expect(url.searchParams.get('scope') ?? '').not.toContain('api.connectors')
    expect(url.searchParams.get('state')).toBe(prepared.state)
    expect(prepared.codeVerifier.length).toBeGreaterThan(0)
  })
})

describe('readChatGptPlanDisplayName', () => {
  it('maps official Pro aliases to the user-facing Pro tier', () => {
    expect(readChatGptPlanDisplayName(tokenWithPlan('pro'))).toBe('Pro')
    expect(readChatGptPlanDisplayName(tokenWithPlan('prolite'))).toBe('Pro')
    expect(readChatGptPlanDisplayName(tokenWithPlan('promax'))).toBe('Pro Max')
  })

  it('maps other known plans and ignores untrusted or unknown values', () => {
    expect(readChatGptPlanDisplayName(tokenWithPlan('plus'))).toBe('Plus')
    expect(readChatGptPlanDisplayName(tokenWithPlan('business'))).toBe('Business')
    expect(readChatGptPlanDisplayName(tokenWithPlan('future_internal_tier'))).toBeUndefined()
    expect(readChatGptPlanDisplayName(tokenWithPlan(123))).toBeUndefined()
    expect(readChatGptPlanDisplayName('not-a-jwt')).toBeUndefined()
  })
})
