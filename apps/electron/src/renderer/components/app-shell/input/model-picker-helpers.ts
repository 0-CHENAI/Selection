import {
  connectionModelIdsMatch,
  getModelsForProviderType,
  isLocalConnection,
  isUnsupportedLlmConnection,
  type LlmConnection,
} from '@config/llm-connections'
import type { ModelDefinition } from '@config/models'

/**
 * Format token count for display (e.g., 1500 -> "1.5k", 200000 -> "200k").
 * Shared by the desktop model dropdown and the compact (drawer) model picker.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

/**
 * Strip the "pi/" prefix from model IDs/display names so the user sees a
 * provider-agnostic label in the picker (e.g., "pi/claude-opus" → "claude-opus").
 */
export function stripPiPrefixForDisplay(value: string): string {
  return value.startsWith('pi/') ? value.slice(3) : value
}

export function pickerModelId(model: ModelDefinition | string): string {
  return typeof model === 'string' ? model : model.id
}

export function isPickerModelSelected(currentModel: string, modelId: string): boolean {
  return connectionModelIdsMatch(currentModel, modelId)
}

/**
 * Models shown in the chat picker. Compat connections never fall back to the
 * Anthropic catalog — that would let users pick Claude IDs on ORDER/OpenAI.
 */
export function resolvePickerModels(
  connection: Pick<LlmConnection, 'providerType' | 'models' | 'defaultModel' | 'piAuthProvider'> | null | undefined,
): Array<ModelDefinition | string> {
  if (!connection) return []
  if (connection.models && connection.models.length > 0) return connection.models
  if (connection.defaultModel) return [connection.defaultModel]
  return getModelsForProviderType(connection.providerType, connection.piAuthProvider)
}

export type LivePickerModel = {
  id: string
  name: string
  contextWindow: number
  reasoning: boolean
}

export function isOpenRouterConnection(
  connection: Pick<LlmConnection, 'piAuthProvider'> | null | undefined,
): boolean {
  return connection?.piAuthProvider === 'openrouter'
}

function livePickerModelsToDefinitions(
  models: readonly LivePickerModel[],
): ModelDefinition[] {
  return models.map((model) => {
    const lastPart = model.name.split(/[\s-]/).pop() ?? model.name
    return {
      id: model.id.startsWith('pi/') ? model.id : `pi/${model.id}`,
      name: model.name,
      shortName: model.name.length > 20 ? lastPart : model.name,
      description: '',
      provider: 'pi',
      contextWindow: model.contextWindow,
      supportsThinking: model.reasoning,
    }
  })
}

export function appendMissingPickerModel(
  models: Array<ModelDefinition | string>,
  modelId: string | undefined,
): Array<ModelDefinition | string> {
  if (!modelId) return models
  if (models.some((model) => isPickerModelSelected(modelId, pickerModelId(model)))) {
    return models
  }
  return [...models, modelId]
}

/**
 * Same as resolvePickerModels, but OpenRouter uses the live catalog when
 * the fetch succeeded. Stored 3-tier IDs stay on the connection; this is
 * display-only so Settings / chat can pick models published after the SDK snapshot.
 */
export function resolvePickerModelsWithLive(
  connection: Pick<LlmConnection, 'providerType' | 'models' | 'defaultModel' | 'piAuthProvider'> | null | undefined,
  liveOpenRouter?: readonly LivePickerModel[] | null,
): Array<ModelDefinition | string> {
  if (isOpenRouterConnection(connection) && liveOpenRouter && liveOpenRouter.length > 0) {
    // Live catalog is the source of truth. Snapshot-only IDs like a retired
    // Jamba default 404 on OpenRouter ("No endpoints found").
    return livePickerModelsToDefinitions(liveOpenRouter)
  }
  return resolvePickerModels(connection)
}

/** Catalogs larger than this are previewed until the user searches. */
export const PICKER_COLLAPSE_THRESHOLD = 12
export const PICKER_SEARCH_RESULT_LIMIT = 40

export function connectionPinnedModelIds(
  connection: Pick<LlmConnection, 'models' | 'defaultModel'> | null | undefined,
): string[] {
  if (!connection) return []
  const ids: string[] = []
  const add = (id?: string) => {
    if (!id) return
    if (ids.some((existing) => isPickerModelSelected(existing, id))) return
    ids.push(id)
  }
  if (connection.models) {
    for (const model of connection.models) add(pickerModelId(model))
  }
  add(connection.defaultModel)
  return ids
}

export function pickerModelMatchesQuery(model: ModelDefinition | string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const id = pickerModelId(model)
  const name = typeof model === 'string' ? model : (model.name ?? model.id)
  return (
    id.toLowerCase().includes(needle)
    || stripPiPrefixForDisplay(id).toLowerCase().includes(needle)
    || name.toLowerCase().includes(needle)
  )
}

export function resolveVisiblePickerModels(
  allModels: Array<ModelDefinition | string>,
  options: {
    query?: string
    currentModel?: string
    pinnedIds?: readonly string[]
    collapseThreshold?: number
    searchLimit?: number
  } = {},
): {
  visible: Array<ModelDefinition | string>
  hiddenCount: number
  matchCount: number
  collapsed: boolean
} {
  const query = options.query?.trim() ?? ''
  const threshold = options.collapseThreshold ?? PICKER_COLLAPSE_THRESHOLD
  const searchLimit = options.searchLimit ?? PICKER_SEARCH_RESULT_LIMIT

  if (query) {
    const matches = allModels.filter((model) => pickerModelMatchesQuery(model, query))
    const visible = matches.slice(0, searchLimit)
    return {
      visible,
      hiddenCount: matches.length - visible.length,
      matchCount: matches.length,
      collapsed: false,
    }
  }

  if (allModels.length <= threshold) {
    return {
      visible: allModels,
      hiddenCount: 0,
      matchCount: allModels.length,
      collapsed: false,
    }
  }

  const pinOrder: string[] = []
  const addPin = (id?: string) => {
    if (!id) return
    if (pinOrder.some((existing) => isPickerModelSelected(existing, id))) return
    pinOrder.push(id)
  }
  addPin(options.currentModel)
  for (const id of options.pinnedIds ?? []) addPin(id)

  const visible: Array<ModelDefinition | string> = []
  for (const id of pinOrder) {
    const found = allModels.find((model) => isPickerModelSelected(id, pickerModelId(model)))
    if (found) visible.push(found)
  }

  return {
    visible,
    hiddenCount: Math.max(0, allModels.length - visible.length),
    matchCount: allModels.length,
    collapsed: true,
  }
}

export type ConnectionGroup = [groupName: string, connections: LlmConnection[]]

/**
 * Group connections by provider type for hierarchical picker rendering.
 * Leftover Anthropic connections are omitted so they cannot be selected
 * for new sessions; locked sessions still surface via the unavailable banner.
 * Order is significant for UI: Local, Selection Backend.
 * Empty groups are dropped.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[string, T[]]> {
  const groups: Record<string, T[]> = {
    'Local': [],
    'Selection Backend': [],
  }
  for (const conn of connections) {
    if (isUnsupportedLlmConnection(conn)) continue
    if (conn.providerType === 'pi_compat' && isLocalConnection(conn)) {
      groups['Local'].push(conn)
    } else if (conn.providerType === 'pi' || conn.providerType === 'pi_compat') {
      groups['Selection Backend'].push(conn)
    }
  }
  return Object.entries(groups).filter(([, conns]) => conns.length > 0)
}
