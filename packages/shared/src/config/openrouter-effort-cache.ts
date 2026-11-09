/**
 * Effort lists from the last successful OpenRouter `/models` response.
 * The main process fills this when the picker fetches the catalog. Later
 * sends in that process can resolve layer ① without another request.
 */
const efforts = new Map<string, { efforts: string[]; mandatory?: boolean }>()

export function rememberOpenRouterEfforts(models: ReadonlyArray<{
  id: string
  supportedReasoningEfforts?: string[]
  reasoningMandatory?: boolean
}>): void {
  for (const model of models) {
    if (!model.supportedReasoningEfforts?.length) continue
    const id = model.id.trim().toLowerCase().replace(/^pi\//, '')
    efforts.set(id, {
      efforts: model.supportedReasoningEfforts,
      ...(model.reasoningMandatory ? { mandatory: true } : {}),
    })
  }
}

export function lookupOpenRouterEfforts(modelId: string): { efforts: string[]; mandatory?: boolean } | undefined {
  const id = modelId.trim().toLowerCase().replace(/^pi\//, '')
  return efforts.get(id)
}

export function resetOpenRouterEfforts(): void {
  efforts.clear()
}
