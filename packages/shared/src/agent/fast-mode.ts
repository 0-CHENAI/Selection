import type { LlmConnection } from '../config/llm-connections.ts'

export type FastServiceFamily = 'chatgpt' | 'grok'

function normalizedModelId(model: string): string {
  return model.replace(/^pi\//, '').replace(/^openai-codex\//, '')
}

/** Fast is a service tier, independent of reasoning effort. Keep eligibility explicit. */
export function supportsGptOAuthFast(model: string, provider?: string): boolean {
  const id = normalizedModelId(model)
  return provider === 'openai-codex' && /^(gpt-6\.1-(sol|terra)|gpt-6-(astra|sol|luna)|gpt-5\.6-(sol|terra|luna))$/.test(id)
}

export function fastServiceFamily(model: string, provider?: string): FastServiceFamily | undefined {
  if (supportsGptOAuthFast(model, provider)) return 'chatgpt'
  if (provider === 'xai' && /^grok-/i.test(normalizedModelId(model))) return 'grok'
  return undefined
}

export function supportsPriorityFast(model: string, provider?: string): boolean {
  return fastServiceFamily(model, provider) !== undefined
}

export function fastServiceTier(enabled: boolean | undefined, model: string, provider?: string): 'priority' | 'default' | undefined {
  if (!supportsPriorityFast(model, provider)) return undefined
  return enabled ? 'priority' : 'default'
}

export function gptOAuthServiceTier(enabled: boolean | undefined, model: string, provider?: string): 'priority' | 'default' | undefined {
  if (!supportsGptOAuthFast(model, provider)) return undefined
  // Explicit default also overrides any upstream default when Fast is off.
  return enabled ? 'priority' : 'default'
}

/** Match the wire protocol and official endpoint, not a connection display name. */
export function fastTransportFamily(model: string, provider: string | undefined, api: string | undefined, baseUrl: string | undefined): FastServiceFamily | undefined {
  const family = fastServiceFamily(model, provider)
  if (!family || !baseUrl) return undefined
  if (api !== (family === 'chatgpt' ? 'openai-codex-responses' : 'openai-completions')) return undefined
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return undefined
    const path = url.pathname.replace(/\/+$/, '')
    if (family === 'chatgpt' && url.hostname === 'chatgpt.com' && ['/backend-api', '/backend-api/codex'].includes(path)) return family
    if (family === 'grok' && url.hostname === 'api.x.ai' && path === '/v1') return family
  } catch { /* Invalid or unavailable endpoints have no known Fast contract. */ }
  return undefined
}

export function fastConnectionFamily(model: string, connection: Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'authType' | 'baseUrl' | 'customEndpoint'> | null | undefined): FastServiceFamily | undefined {
  if (!connection || connection.providerType !== 'pi') return undefined
  const provider = connection.piAuthProvider
  if (provider === 'openai-codex') {
    if (connection.authType !== 'oauth' || connection.customEndpoint) return undefined
    return fastTransportFamily(model, provider, 'openai-codex-responses', connection.baseUrl ?? 'https://chatgpt.com/backend-api')
  }
  if (provider === 'xai') {
    if (!['api_key', 'api_key_with_endpoint'].includes(connection.authType)) return undefined
    return fastTransportFamily(model, provider, connection.customEndpoint?.api ?? 'openai-completions', connection.baseUrl ?? 'https://api.x.ai/v1')
  }
  return undefined
}
