import {
  connectionModelIdsMatch,
  getModelsForProviderType,
  isLocalConnection,
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

export type ConnectionGroup = [groupName: string, connections: LlmConnection[]]

/**
 * Group connections by provider type for hierarchical picker rendering.
 * Each provider section can contain multiple connections (API Key, OAuth, …).
 * Order is significant for UI: Anthropic, Local, Selection Backend.
 * Empty groups are dropped.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[string, T[]]> {
  const groups: Record<string, T[]> = {
    'Anthropic': [],
    'Local': [],
    'Selection Backend': [],
  }
  for (const conn of connections) {
    const provider = conn.providerType || 'anthropic'
    if (provider === 'anthropic') {
      groups['Anthropic'].push(conn)
    } else if (provider === 'pi_compat' && isLocalConnection(conn)) {
      groups['Local'].push(conn)
    } else if (provider === 'pi' || provider === 'pi_compat') {
      groups['Selection Backend'].push(conn)
    }
  }
  return Object.entries(groups).filter(([, conns]) => conns.length > 0)
}
