import {
  modelThinkingCapability,
  thinkingLevelMapForLevels,
  type ThinkingMode,
} from '../../shared/src/agent/thinking-capabilities.ts'
import {
  DEFAULT_CUSTOM_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MAX_TOKENS,
  inferModelSupportsImages,
  normalizeConnectionModelId,
  sanitizeCustomContextWindow,
  sanitizeCustomMaxTokens,
} from '../../shared/src/config/model-image-support.ts'

export type CustomEndpointInput = 'text' | 'image'

/** Custom endpoint protocol — determines which streaming adapter Pi SDK uses. */
export type CustomEndpointApi = 'openai-completions' | 'anthropic-messages'

export interface CustomEndpointModelDefaults {
  supportsImages?: boolean
}

export interface CustomEndpointModelOverrides {
  contextWindow?: number
  maxTokens?: number
  supportedThinkingLevels?: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  thinkingMode?: ThinkingMode;
  supportsImages?: boolean
}

export interface CustomEndpointModelEntry extends CustomEndpointModelOverrides {
  id: string
}

export type CustomEndpointModelConfig = string | {
  id: string
  contextWindow?: number
  maxTokens?: number
  supportedThinkingLevels?: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  thinkingMode?: ThinkingMode;
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
    ...(model.thinkingMode ? { thinkingMode: model.thinkingMode } : {}),
    ...(model.supportedThinkingLevels !== undefined ? { supportedThinkingLevels: model.supportedThinkingLevels } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {}),
  }
}

function resolveCustomEndpointThinking(
  id: string,
  overrides?: CustomEndpointModelOverrides,
): { reasoning: boolean; map?: Record<string, string | null> } {
  if (overrides?.thinkingMode === 'always-on') {
    return { reasoning: true, map: { ...thinkingLevelMapForLevels(['low']), off: null } }
  }
  if (overrides?.thinkingMode === 'unsupported') return { reasoning: false }
  const declared = overrides?.supportedThinkingLevels
  if (declared !== undefined) {
    const enabled = declared.some(level => level !== 'off')
    return enabled
      ? { reasoning: true, map: thinkingLevelMapForLevels(declared) }
      : { reasoning: false, map: thinkingLevelMapForLevels([]) }
  }
  const inferred = modelThinkingCapability({ id })
  if (inferred.mode === 'always-on') {
    return { reasoning: true, map: { ...thinkingLevelMapForLevels(['low']), off: null } }
  }
  if (inferred.mode === 'levels' && inferred.levels.some(level => level !== 'off')) {
    return { reasoning: true, map: thinkingLevelMapForLevels(inferred.levels) }
  }
  return { reasoning: false }
}

/**
 * Build a synthetic model definition for a custom endpoint.
 * Context window comes from the stored catalog when present, otherwise 128k.
 * Image support:
 *   per-model override ?? connection default ?? conservative name heuristic.
 */
export function buildCustomEndpointModelDef(
  id: string,
  defaults?: CustomEndpointModelDefaults,
  overrides?: CustomEndpointModelOverrides,
  api?: CustomEndpointApi,
) {
  const supportsImages = overrides?.supportsImages
    ?? defaults?.supportsImages
    ?? inferModelSupportsImages(id)
  const input: CustomEndpointInput[] = supportsImages ? ['text', 'image'] : ['text']
  const contextWindow = sanitizeCustomContextWindow(overrides?.contextWindow) ?? DEFAULT_CUSTOM_CONTEXT_WINDOW
  const maxTokens = sanitizeCustomMaxTokens(
    overrides?.maxTokens ?? DEFAULT_CUSTOM_MAX_TOKENS,
    contextWindow,
  ) ?? Math.min(DEFAULT_CUSTOM_MAX_TOKENS, contextWindow)
  const thinking = resolveCustomEndpointThinking(id, overrides)

  return {
    id,
    name: id,
    reasoning: thinking.reasoning,
    ...(thinking.map ? { thinkingLevelMap: thinking.map } : {}),
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
    // `store` is an OpenAI-only field. `developer` is the reasoning-model
    // alias for a system prompt; compatible gateways reject that role.
    // Third-party Anthropic Messages endpoints often return thinking blocks
    // with an empty signature and require that block on the next turn.
    ...(api === 'openai-completions' ? { compat: { supportsStore: false, supportsDeveloperRole: false } } : {}),
    ...(api === 'anthropic-messages' ? { compat: { allowEmptySignature: true } } : {}),
  }
}
