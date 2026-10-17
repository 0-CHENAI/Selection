/**
 * Bare model id shared by the capability table and the probe cache.
 * Kept in its own module so those two files do not import each other.
 */
export function bareThinkingModelId(modelId: string): string {
  let value = modelId.trim().toLowerCase()
  if (value.startsWith('pi/')) value = value.slice(3)
  value = value.replace(/^(global|us|eu)\.anthropic\./, '')
  value = value.replace(/^anthropic\./, '')
  const slash = value.lastIndexOf('/')
  if (slash >= 0) value = value.slice(slash + 1)
  value = value.replace(/:[\w.+-]+$/, '')
  value = value.replace(/claude-(opus|sonnet|haiku)-(\d+)\.(\d+)/, 'claude-$1-$2-$3')
  return value
}

/** Id with only the `pi/` prefix removed. OpenRouter keys keep `vendor/model`. */
export function catalogThinkingModelId(modelId: string): string {
  let value = modelId.trim().toLowerCase()
  if (value.startsWith('pi/')) value = value.slice(3)
  return value
}
