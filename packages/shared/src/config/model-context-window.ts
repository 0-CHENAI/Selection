/**
 * Context-window resolution for models added with an API key.
 *
 * Order:
 * 1. A stored manual override (the existing per-model limit field).
 * 2. Metadata the endpoint returned (`/v1/models`).
 * 3. A known preset (DeepSeek, Kimi, or the registered Pi catalog).
 * 4. The caller-supplied safe default.
 *
 * The static table is renderer-safe. The main process replaces it with the
 * full Pi catalog via `registerKnownModelContextLookup`.
 */

import {
  DEFAULT_CUSTOM_CONTEXT_WINDOW,
  normalizeConnectionModelId,
  sanitizeCustomContextWindow,
  sanitizeCustomMaxTokens,
} from './model-image-support.ts'

export const SAFE_MODEL_CONTEXT_WINDOW = DEFAULT_CUSTOM_CONTEXT_WINDOW

export interface KnownModelLimits {
  contextWindow: number
  maxTokens?: number
}

export interface ModelContextWindowSources {
  /** Value the user typed in the existing limit field, or a previously saved override. */
  manual?: number
  /** Value declared by the endpoint catalog. */
  endpoint?: number
  /** Value from a known preset or provider catalog. */
  known?: number
  /** Used only when every source above is missing. */
  fallback?: number
}

/**
 * DeepSeek and Kimi preset windows. Kept in sync with the Pi SDK catalog by
 * `model-context-window.test.ts`. Other providers come from the registered lookup.
 */
const KNOWN_PRESET_CONTEXT_WINDOWS: Readonly<Record<string, KnownModelLimits>> = {
  'deepseek-flash': { contextWindow: 1_000_000, maxTokens: 384_000 },
  'deepseek-v4-flash': { contextWindow: 1_000_000, maxTokens: 384_000 },
  'deepseek-v4-pro': { contextWindow: 1_000_000, maxTokens: 384_000 },
  'kimi-k2.6': { contextWindow: 262_144, maxTokens: 262_144 },
  'kimi-k2.7-code': { contextWindow: 262_144, maxTokens: 262_144 },
  'kimi-k2.7-code-highspeed': { contextWindow: 262_144, maxTokens: 262_144 },
  'kimi-k3': { contextWindow: 1_048_576, maxTokens: 1_048_576 },
  'k3': { contextWindow: 1_048_576, maxTokens: 131_072 },
  'k3-256k': { contextWindow: 262_144, maxTokens: 131_072 },
  'kimi-for-coding': { contextWindow: 1_048_576, maxTokens: 32_768 },
  'kimi-for-coding-highspeed': { contextWindow: 262_144, maxTokens: 32_768 },
}

type KnownModelContextLookup = (modelId: string) => KnownModelLimits | undefined

let knownModelContextLookup: KnownModelContextLookup | undefined

/** Main-process hook for the full Pi catalog. Renderer code keeps the static table. */
export function registerKnownModelContextLookup(lookup: KnownModelContextLookup): void {
  knownModelContextLookup = lookup
}

function sanitizeLimits(limits: KnownModelLimits | undefined): KnownModelLimits | undefined {
  const contextWindow = sanitizeCustomContextWindow(limits?.contextWindow)
  if (contextWindow === undefined) return undefined
  const maxTokens = sanitizeCustomMaxTokens(limits?.maxTokens, contextWindow)
  return maxTokens !== undefined ? { contextWindow, maxTokens } : { contextWindow }
}

export function lookupKnownModelLimits(modelId: string): KnownModelLimits | undefined {
  const bare = normalizeConnectionModelId(modelId).toLowerCase()
  if (!bare) return undefined
  const registered = sanitizeLimits(knownModelContextLookup?.(modelId) ?? knownModelContextLookup?.(bare))
  if (registered) return registered
  return sanitizeLimits(KNOWN_PRESET_CONTEXT_WINDOWS[bare])
}

export function lookupKnownModelContextWindow(modelId: string): number | undefined {
  return lookupKnownModelLimits(modelId)?.contextWindow
}

export function resolveApiKeyModelContextWindow(sources: ModelContextWindowSources): number | undefined {
  const manual = sanitizeCustomContextWindow(sources.manual)
  if (manual !== undefined) return manual
  const endpoint = sanitizeCustomContextWindow(sources.endpoint)
  if (endpoint !== undefined) return endpoint
  const known = sanitizeCustomContextWindow(sources.known)
  if (known !== undefined) return known
  return sanitizeCustomContextWindow(sources.fallback)
}

/**
 * Window used for context display and compaction.
 * Stored manual/endpoint value, then the live endpoint value, then a known
 * preset or the app registry, then the safe default. An empty model id stays
 * unresolved so a not-yet-chosen model does not pretend to have 128k.
 */
export function resolveRuntimeModelContextWindow(input: {
  modelId: string
  stored?: number
  endpoint?: number
  known?: number
  registry?: number
}): number | undefined {
  if (!input.modelId.trim()) return undefined
  const known = sanitizeCustomContextWindow(input.known) ?? sanitizeCustomContextWindow(input.registry)
  return resolveApiKeyModelContextWindow({
    manual: input.stored,
    endpoint: input.endpoint,
    known,
    fallback: SAFE_MODEL_CONTEXT_WINDOW,
  })
}

/** Fill a missing catalog window from the known preset table. Endpoint values stay. */
export function enrichListedModelLimits<T extends { id: string; contextWindow?: number; maxTokens?: number }>(
  model: T,
): T {
  if (sanitizeCustomContextWindow(model.contextWindow) !== undefined) return model
  const known = lookupKnownModelLimits(model.id)
  if (!known) return model
  return {
    ...model,
    contextWindow: known.contextWindow,
    ...(model.maxTokens == null && known.maxTokens !== undefined ? { maxTokens: known.maxTokens } : {}),
  }
}

type StoredModelRecord = { id: string; contextWindow?: number; maxTokens?: number }
type StoredModel = string | StoredModelRecord

/**
 * Promote a string id to an object when a known preset has a context window.
 * A window already stored on the model (manual or endpoint) is left alone.
 * The safe default is not written here — callers apply it at read time so a
 * later catalog match is not frozen as 128k.
 */
export function withResolvedContextWindow<T extends StoredModel>(model: T): T | { id: string; contextWindow: number; maxTokens?: number } {
  const id = typeof model === 'string' ? model : model.id
  const stored = typeof model === 'string' ? undefined : sanitizeCustomContextWindow(model.contextWindow)
  if (stored !== undefined) return model
  const known = lookupKnownModelLimits(id)
  if (!known) return model
  if (typeof model === 'string') {
    return {
      id,
      contextWindow: known.contextWindow,
      ...(known.maxTokens !== undefined ? { maxTokens: known.maxTokens } : {}),
    }
  }
  const record = model as StoredModelRecord
  return {
    ...record,
    contextWindow: known.contextWindow,
    ...(record.maxTokens == null && known.maxTokens !== undefined ? { maxTokens: known.maxTokens } : {}),
  }
}
