import { getModelProvider, getModelShortName } from '@config/models'
import {
  getDefaultModelsForConnection,
  isUnsupportedLlmConnection,
  type LlmConnectionWithStatus,
} from '@config/llm-connections'
import { isOrderGatewayUrl } from '@config/order-gateway'
import type { KanbanModelProviderGroup } from './types'

/** First catalog id, or `preferred` only when that id is actually served. */
export function catalogDefaultModel(
  groups: KanbanModelProviderGroup[],
  preferred?: string,
): string | undefined {
  const ids = new Set(groups.flatMap((g) => g.models.map((m) => m.id)))
  if (preferred && ids.has(preferred)) return preferred
  return groups[0]?.models[0]?.id
}

/**
 * Brand icon for a model chip. Unknown aliases (Laufry / ORDER Opus) and
 * leftover Anthropic registry ids must not draw the Claude spark — chat
 * already treats ORDER as wordmark-only.
 */
export function modelChipProvider(model: string): string | null {
  const provider = getModelProvider(model)
  if (!provider || provider === 'anthropic') return null
  return provider
}

export function catalogProviderKey(
  conn: Pick<LlmConnectionWithStatus, 'providerType' | 'piAuthProvider' | 'baseUrl'>,
): string {
  if (isOrderGatewayUrl(conn.baseUrl)) return 'order'
  if (conn.providerType === 'anthropic') return 'anthropic'
  return conn.piAuthProvider || conn.providerType
}

export function buildModelCatalog(connections: LlmConnectionWithStatus[]): {
  groups: KanbanModelProviderGroup[]
  modelToConnection: Map<string, string>
} {
  const groups: KanbanModelProviderGroup[] = []
  const modelToConnection = new Map<string, string>()

  for (const conn of connections) {
    if (!conn.isAuthenticated) continue
    if (isUnsupportedLlmConnection(conn)) continue
    const rawModels = conn.models?.length
      ? conn.models
      : getDefaultModelsForConnection(conn.providerType, conn.piAuthProvider)
    const models = rawModels.map((m) => {
      const id = typeof m === 'string' ? m : m.id
      const name = typeof m === 'string' ? getModelShortName(m) : m.name || getModelShortName(m.id)
      return { id, name }
    })
    if (models.length === 0) continue
    for (const m of models) modelToConnection.set(m.id, conn.slug)
    groups.push({ provider: catalogProviderKey(conn), label: conn.name, models })
  }

  return { groups, modelToConnection }
}
