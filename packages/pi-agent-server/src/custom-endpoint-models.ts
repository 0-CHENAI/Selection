import {
  inferModelSupportsImages,
  normalizeConnectionModelId,
} from '../../shared/src/config/model-image-support.ts'

export type CustomEndpointInput = 'text' | 'image'

export interface CustomEndpointModelDefaults {
  supportsImages?: boolean
}

export interface CustomEndpointModelOverrides {
  contextWindow?: number
  supportsImages?: boolean
}

export interface CustomEndpointModelEntry extends CustomEndpointModelOverrides {
  id: string
}

export type CustomEndpointModelConfig = string | {
  id: string
  contextWindow?: number
  supportsImages?: boolean
}

/** Strip runtime provider prefixes so stored and live IDs compare as the same model. */
export function stripPiPrefix(id: string): string {
  return normalizeConnectionModelId(id)
}

export function findCustomEndpointModelEntry(
  modelId: string,
  customModels?: CustomEndpointModelConfig[],
): CustomEndpointModelEntry {
  const bareId = stripPiPrefix(modelId)
  const match = customModels?.find((model) => {
    const id = typeof model === 'string' ? model : model.id
    return stripPiPrefix(id).toLowerCase() === bareId.toLowerCase()
  })
  return match ? normalizeCustomEndpointModelEntry(match) : { id: bareId }
}

/**
 * Normalize a user-configured custom endpoint model for Pi SDK registration.
 *
 * Keep explicit per-model capability overrides intact. In particular,
 * `supportsImages: false` is meaningful because it can override a global
 * endpoint default of `supportsImages: true` for text-only models.
 */
export function normalizeCustomEndpointModelEntry(model: CustomEndpointModelConfig): CustomEndpointModelEntry {
  if (typeof model === 'string') {
    return { id: stripPiPrefix(model) }
  }

  return {
    id: stripPiPrefix(model.id),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {}),
  }
}

/**
 * Build a synthetic model definition for a custom endpoint.
 * Uses reasonable defaults for context window and max tokens since we can't
 * query the endpoint for its actual capabilities. Image support:
 *   per-model override ?? connection default ?? conservative name heuristic.
 */
export function buildCustomEndpointModelDef(
  id: string,
  defaults?: CustomEndpointModelDefaults,
  overrides?: CustomEndpointModelOverrides,
) {
  const supportsImages = overrides?.supportsImages
    ?? defaults?.supportsImages
    ?? inferModelSupportsImages(id)
  const input: CustomEndpointInput[] = supportsImages ? ['text', 'image'] : ['text']

  return {
    id,
    name: id,
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: overrides?.contextWindow ?? 131_072,
    maxTokens: 8_192,
  }
}
