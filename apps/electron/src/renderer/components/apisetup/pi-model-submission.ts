/**
 * Models saved from the API-key catalog picker.
 *
 * The checked models are the enabled set. Callers treat the first id as the
 * connection default. Context window: manual override, then the catalog value
 * (Pi SDK or `/v1/models`), then a known preset, then the safe default.
 */

import {
  SAFE_MODEL_CONTEXT_WINDOW,
  enrichListedModelLimits,
  lookupKnownModelLimits,
  resolveApiKeyModelContextWindow,
} from '../../../../../../packages/shared/src/config/model-context-window.ts'

export interface PiCatalogModel {
  id: string
  name: string
  contextWindow?: number
}

export interface SubmittedPiModel {
  id: string
  contextWindow: number
  maxTokens?: number
}

export function piCatalogToRemoteModels<T extends PiCatalogModel>(models: readonly T[]): Array<T & { contextWindow?: number }> {
  return models.map((model) => enrichListedModelLimits({
    ...model,
    contextWindow: model.contextWindow && model.contextWindow > 0 ? model.contextWindow : undefined,
  }))
}

export function buildPiApiKeyModels(
  selectedIds: readonly string[],
  catalog: readonly PiCatalogModel[],
  overrides?: { contextWindows?: Record<string, number>; maxTokens?: Record<string, number> },
): SubmittedPiModel[] {
  return selectedIds.map((id) => {
    const listed = catalog.find((model) => model.id === id)
    const endpoint = listed?.contextWindow && listed.contextWindow > 0 ? listed.contextWindow : undefined
    const known = lookupKnownModelLimits(id)
    const contextWindow = resolveApiKeyModelContextWindow({
      manual: overrides?.contextWindows?.[id],
      endpoint,
      known: known?.contextWindow,
      fallback: SAFE_MODEL_CONTEXT_WINDOW,
    }) ?? SAFE_MODEL_CONTEXT_WINDOW
    const maxTokens = overrides?.maxTokens?.[id] ?? (endpoint === undefined ? known?.maxTokens : undefined)
    return {
      id,
      contextWindow,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    }
  })
}
