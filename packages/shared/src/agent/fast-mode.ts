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
