/** Fast is a service tier, independent of reasoning effort. Keep eligibility explicit. */
export function supportsGptOAuthFast(model: string, provider?: string): boolean {
  const id = model.replace(/^pi\//, '').replace(/^openai-codex\//, '')
  return provider === 'openai-codex' && /^(gpt-6\.1-(sol|terra)|gpt-6-(astra|sol|luna)|gpt-5\.6-(sol|terra|luna))$/.test(id)
}

export function gptOAuthServiceTier(enabled: boolean | undefined, model: string, provider?: string): 'priority' | 'default' | undefined {
  if (!supportsGptOAuthFast(model, provider)) return undefined
  // Explicit default also overrides any upstream default when Fast is off.
  return enabled ? 'priority' : 'default'
}
