/**
 * Custom-endpoint image capability helpers.
 *
 * Stored model IDs (Opus) and runtime IDs (pi/Opus, custom-endpoint/Opus)
 * must compare as the same model, or vision flags never apply at send time.
 */

const PROVIDER_PREFIXES = ['pi/', 'custom-endpoint/']

export function normalizeConnectionModelId(id: string): string {
  let value = id.trim()
  for (const prefix of PROVIDER_PREFIXES) {
    if (value.toLowerCase().startsWith(prefix)) {
      value = value.slice(prefix.length)
    }
  }
  return value
}

export function connectionModelIdsMatch(a: string, b: string): boolean {
  const left = normalizeConnectionModelId(a)
  const right = normalizeConnectionModelId(b)
  if (!left || !right) return false
  return left === right || left.toLowerCase() === right.toLowerCase()
}

// Bounded tokens so `octopus`, `omnibox`, and `foo-vllm` stay text-only.
const VISION_TOKEN = /(?:^|[^a-z0-9])(?:opus|sonnet|haiku|claude|gemini|pixtral|internvl|omni|multimodal|vision|llama-4|gemma-3|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|qwen-vl|qwen2\.5-vl|qwen2-vl)(?:[^a-z0-9]|$)/
const VL_AFFIX = /(?:^|[.-])vl(?:[^a-z]|$)/

/** ORDER catalog names that take images but do not look like common vision models. */
const ORDER_VISION_IDS = new Set(['laufry'])

/**
 * Conservative name heuristic when the catalog does not declare capabilities.
 * Unknown ORDER names stay false unless the user enables images explicitly.
 */
export function inferModelSupportsImages(id: string, name?: string): boolean {
  const bare = normalizeConnectionModelId(id).toLowerCase()
  const display = (name ?? '').trim().toLowerCase()
  if (ORDER_VISION_IDS.has(bare) || (display && ORDER_VISION_IDS.has(display))) return true
  const haystack = `${bare} ${display}`
  return VISION_TOKEN.test(haystack) || VL_AFFIX.test(haystack)
}

export type CustomEndpointModelSource =
  | string
  | {
      id: string
      name?: string
      contextWindow?: number
      maxTokens?: number
      supportsImages?: boolean
    }

export type CustomEndpointModelPayload =
  | string
  | {
      id: string
      contextWindow?: number
      maxTokens?: number
      supportsImages?: boolean
    }

/**
 * Shape sent to the Pi subprocess. Only explicit stored flags are forwarded
 * so connection-level `customEndpoint.supportsImages` remains authoritative.
 * Name inference happens later in `buildCustomEndpointModelDef`.
 */
export function toCustomEndpointModelPayload(
  model: CustomEndpointModelSource,
): CustomEndpointModelPayload {
  const id = typeof model === 'string' ? model : model.id
  const contextWindow = typeof model === 'string' ? undefined : model.contextWindow
  const maxTokens = typeof model === 'string' ? undefined : model.maxTokens
  const explicit = typeof model === 'object' && typeof model.supportsImages === 'boolean'
    ? model.supportsImages
    : undefined
  if (contextWindow || maxTokens || explicit !== undefined) {
    return {
      id,
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      ...(explicit !== undefined ? { supportsImages: explicit } : {}),
    }
  }
  return id
}

/** Stored catalog window for a custom-endpoint model, if one was persisted. */
export function resolveCustomModelContextWindow(
  models: Array<string | { id: string; contextWindow?: number }> | undefined,
  modelId: string,
): number | undefined {
  if (!models?.length || !modelId) return undefined
  const match = models.find((model) => {
    const id = typeof model === 'string' ? model : model.id
    return connectionModelIdsMatch(id, modelId)
  })
  if (!match || typeof match === 'string') return undefined
  const window = match.contextWindow
  if (typeof window !== 'number' || !Number.isFinite(window) || window <= 0) return undefined
  return Math.floor(window)
}
