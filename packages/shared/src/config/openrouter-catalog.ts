/**
 * Live OpenRouter model catalog.
 *
 * The Pi SDK ships a generated snapshot. OpenRouter publishes models
 * continuously, so API setup and Pi model refresh read GET /api/v1/models
 * and only fall back to that snapshot when the request fails.
 */

import type { ModelDefinition } from './models.ts'

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1'

const MIN_CONTEXT_WINDOW = 1_024
const MAX_CONTEXT_WINDOW = 10_000_000
const DEFAULT_CONTEXT_WINDOW = 131_072

export interface OpenRouterCatalogModel {
  id: string
  name: string
  costInput: number
  costOutput: number
  contextWindow: number
  reasoning: boolean
}

export interface PiProviderPickerModel {
  id: string
  name: string
  costInput: number
  costOutput: number
  contextWindow: number
  reasoning: boolean
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseContextWindow(value: unknown): number | undefined {
  const raw = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const tokens = Math.floor(raw)
  if (tokens < MIN_CONTEXT_WINDOW || tokens > MAX_CONTEXT_WINDOW) return undefined
  return tokens
}

/** OpenRouter documents prompt/completion as USD per token. */
function perMillionTokens(value: unknown): number {
  const raw = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0
  return Number((raw * 1_000_000).toFixed(6))
}

function isTextChatModel(rec: Record<string, unknown>): boolean {
  const arch = asRecord(rec.architecture)
  const outputs = arch?.output_modalities ?? arch?.outputModalities
  if (Array.isArray(outputs) && outputs.length > 0) {
    return outputs.some((entry) => String(entry).toLowerCase() === 'text')
  }
  const modality = typeof arch?.modality === 'string' ? arch.modality.toLowerCase() : ''
  if (!modality) return true
  if (modality.includes('embedding') || modality.includes('rerank')) return false
  if (modality.includes('->')) return /->\s*text\b/.test(modality)
  return modality.includes('text')
}

function isExpiredCatalogModel(rec: Record<string, unknown>): boolean {
  const raw = rec.expiration_date ?? rec.expirationDate
  if (typeof raw !== 'string' || !raw.trim()) return false
  const expiresAt = Date.parse(raw)
  return Number.isFinite(expiresAt) && expiresAt < Date.now()
}

function hasReasoning(rec: Record<string, unknown>): boolean {
  const params = rec.supported_parameters ?? rec.supportedParameters
  if (!Array.isArray(params)) return false
  return params.some((entry) => {
    const value = String(entry).toLowerCase()
    return value === 'reasoning' || value === 'include_reasoning' || value === 'reasoning_effort'
  })
}

export function parseOpenRouterModelsPayload(json: unknown): OpenRouterCatalogModel[] {
  const root = asRecord(json)
  const rows = Array.isArray(json)
    ? json
    : (root && Array.isArray(root.data) ? root.data : [])

  const seen = new Set<string>()
  const models: OpenRouterCatalogModel[] = []
  for (const row of rows) {
    const rec = asRecord(row)
    if (!rec) continue
    const id = String(rec.id ?? '').trim()
    if (!id || seen.has(id) || !isTextChatModel(rec) || isExpiredCatalogModel(rec)) continue
    seen.add(id)

    const pricing = asRecord(rec.pricing)
    const topProvider = asRecord(rec.top_provider)
    const contextWindow = parseContextWindow(
      rec.context_length ?? rec.context_window ?? rec.contextWindow ?? topProvider?.context_length,
    ) ?? DEFAULT_CONTEXT_WINDOW

    models.push({
      id,
      name: String(rec.name ?? rec.display_name ?? id).trim() || id,
      costInput: perMillionTokens(pricing?.prompt),
      costOutput: perMillionTokens(pricing?.completion),
      contextWindow,
      reasoning: hasReasoning(rec),
    })
  }
  return models
}

export function formatPiProviderPickerModels(
  models: Array<OpenRouterCatalogModel | PiProviderPickerModel>,
): { models: PiProviderPickerModel[]; totalCount: number } {
  const sorted = [...models].sort((a, b) => b.costOutput - a.costOutput || b.costInput - a.costInput)
  return {
    models: sorted.map((model) => ({
      id: model.id.startsWith('pi/') ? model.id : `pi/${model.id}`,
      name: model.name,
      costInput: model.costInput,
      costOutput: model.costOutput,
      contextWindow: model.contextWindow,
      reasoning: model.reasoning,
    })),
    totalCount: models.length,
  }
}

export function openRouterCatalogToModelDefinitions(
  models: OpenRouterCatalogModel[],
): ModelDefinition[] {
  return models.map((model) => {
    const lastPart = model.name.split(/[\s-]/).pop() ?? model.name
    return {
      id: `pi/${model.id}`,
      name: model.name,
      shortName: model.name.length > 20 ? lastPart : model.name,
      description: 'openrouter model via Selection Backend',
      provider: 'pi',
      contextWindow: model.contextWindow,
      supportsThinking: model.reasoning,
    }
  })
}

export type OpenRouterFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>

export async function fetchOpenRouterCatalog(options: {
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: OpenRouterFetch
} = {}): Promise<OpenRouterCatalogModel[]> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? 15_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const apiKey = options.apiKey?.trim()
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetchImpl(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`openrouter_models_http_${response.status}`)
    }
    return parseOpenRouterModelsPayload(await response.json())
  } finally {
    clearTimeout(timer)
  }
}
