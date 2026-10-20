import type { CustomEndpointApi, CustomEndpointConfig } from '@config/llm-connections'

export type PresetKey = string

export interface CustomEndpointModelSubmissionInput {
  id: string
  name?: string
  includeDisplayNames?: boolean
  supportedThinkingLevels?: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>
  thinkingMode?: 'unsupported' | 'always-on' | 'levels'
  supportsImages?: boolean
  imageSupport?: 'auto' | 'on' | 'off'
  learnedSupportsImages?: boolean
  contextWindow: number
  maxTokens: number
}

/** Build the persisted model shape consistently for ORDER and generic endpoints. */
export function buildCustomEndpointModelSubmission(
  input: CustomEndpointModelSubmissionInput,
) {
  const displayName = input.name ?? input.id
  return {
    id: input.id,
    ...(input.includeDisplayNames
      ? { name: displayName, shortName: displayName }
      : {}),
    ...(input.thinkingMode || input.supportedThinkingLevels !== undefined ? { thinkingSource: 'explicit' as const } : {}),
    ...(input.thinkingMode ? { thinkingMode: input.thinkingMode } : {}),
    ...(input.supportedThinkingLevels !== undefined ? {
      supportedThinkingLevels: input.supportedThinkingLevels,
      supportsThinking: input.thinkingMode === 'always-on' || input.supportedThinkingLevels.some(level => level !== 'off'),
    } : {}),
    ...(input.imageSupport === 'on' || input.imageSupport === 'off'
      ? { imageSupport: input.imageSupport, supportsImages: input.imageSupport === 'on' }
      : input.imageSupport === 'auto'
        ? {
          imageSupport: 'auto' as const,
          ...(input.learnedSupportsImages === false ? { learnedSupportsImages: false as const } : {}),
        }
        : typeof input.supportsImages === 'boolean'
          ? { supportsImages: input.supportsImages }
          : {}),
    contextWindow: input.contextWindow,
    maxTokens: input.maxTokens,
  }
}

/**
 * Preset keys that are regional variants of a canonical Pi auth provider.
 * The Pi SDK recognizes both 'minimax' and 'minimax-cn' as separate providers
 * with distinct base URLs (api.minimax.io vs api.minimaxi.com), so only
 * 'minimax-global' needs aliasing — 'minimax-cn' maps 1:1 to the Pi SDK provider.
 */
const PI_AUTH_PROVIDER_ALIASES: Record<string, string> = {
  'minimax-global': 'minimax',
}

/**
 * Automatic catalog probes send the API key as soon as it is pasted.
 * A custom endpoint waits for the Fetch models button, which can read
 * either an OpenAI or an Anthropic model list. Branded OpenAI presets
 * still probe on their own.
 */
export function shouldAutoProbeModelCatalog(activePreset: string, customApi: CustomEndpointApi): boolean {
  if (activePreset === 'custom') return false
  return customApi !== 'anthropic-messages'
}

/**
 * Custom endpoints ask the user which wire format to use.
 * The URL is not consulted: api.anthropic.com and third-party gateways can
 * both speak either protocol, and guessing from the host gets it wrong.
 */
export function showCustomFormatPicker(activePreset: string): boolean {
  return activePreset === 'custom'
}

export function resolvePiAuthProviderForSubmit(
  activePreset: PresetKey,
  lastNonCustomPreset: PresetKey | null
): string | undefined {
  if (activePreset === 'custom') {
    // Pi SDK needs a provider hint for auth header formatting even when
    // the URL is user-provided — default to openai for OpenAI Compatible.
    const resolved = lastNonCustomPreset && lastNonCustomPreset !== 'custom'
      ? lastNonCustomPreset
      : 'openai'
    return PI_AUTH_PROVIDER_ALIASES[resolved] ?? resolved
  }

  return PI_AUTH_PROVIDER_ALIASES[activePreset] ?? activePreset
}

export function resolvePresetStateForBaseUrlChange(params: {
  matchedPreset: PresetKey
  activePreset: PresetKey
  activePresetHasEmptyUrl: boolean
  lastNonCustomPreset: PresetKey | null
}): { activePreset: PresetKey; lastNonCustomPreset: PresetKey | null } {
  const { matchedPreset, activePreset, activePresetHasEmptyUrl, lastNonCustomPreset } = params

  // A custom endpoint keeps the format buttons. Matching a built-in URL
  // (Kimi Coding, OpenRouter, api.anthropic.com, …) must not leave Custom,
  // or the OpenAI / Anthropic choice disappears and the URL is treated as
  // that preset's fixed protocol.
  if (activePreset === 'custom') {
    return {
      activePreset: 'custom',
      lastNonCustomPreset,
    }
  }

  if (matchedPreset !== 'custom') {
    return {
      activePreset: matchedPreset,
      lastNonCustomPreset: matchedPreset,
    }
  }

  if (activePresetHasEmptyUrl) {
    return {
      activePreset,
      lastNonCustomPreset,
    }
  }

  return {
    activePreset: 'custom',
    lastNonCustomPreset,
  }
}

/**
 * Resolve the customEndpoint + piAuthProvider payload at submit time.
 *
 * Submit branches:
 *  - branded openai-compat preset (Manifest, ORDER OpenAI) → openai-completions
 *  - generic custom preset with Anthropic Messages         → anthropic-messages
 *  - generic custom preset with a base URL                 → openai-completions
 *  - everything else                                       → no customEndpoint, passthrough piAuth
 */
export function resolveCustomEndpointPayload(params: {
  activePreset: PresetKey
  baseUrl: string
  customApi: CustomEndpointApi
  brandedOpenAiCompatPresets: ReadonlySet<string>
  brandedAnthropicCompatPresets?: ReadonlySet<string>
  fallbackPiAuthProvider: string | undefined
}): {
  customEndpoint: CustomEndpointConfig | undefined
  piAuthProvider: string | undefined
} {
  const {
    activePreset,
    baseUrl,
    customApi,
    brandedOpenAiCompatPresets,
    brandedAnthropicCompatPresets,
    fallbackPiAuthProvider,
  } = params

  const isBrandedOpenAiCompat = brandedOpenAiCompatPresets.has(activePreset) && !!baseUrl
  const isCustomEndpoint =
    (activePreset === 'custom' && !!baseUrl) || isBrandedOpenAiCompat
  const api: CustomEndpointApi = activePreset === 'custom' && customApi === 'anthropic-messages'
    ? 'anthropic-messages'
    : 'openai-completions'

  return {
    customEndpoint: isCustomEndpoint ? { api } : undefined,
    piAuthProvider: isCustomEndpoint
      ? (api === 'anthropic-messages' ? 'anthropic' : 'openai')
      : fallbackPiAuthProvider,
  }
}

/**
 * ORDER shows the checkbox catalog while the key is still short, while the
 * list is loading, or once models have arrived. A failed fetch with a long
 * enough key falls back to the comma-separated field.
 */
export function orderModelFieldMode(input: {
  remoteModelsLoading: boolean
  remoteModelCount: number
  apiKeyLength: number
}): 'picker' | 'manual' {
  if (input.remoteModelsLoading || input.remoteModelCount > 0 || input.apiKeyLength < 8) return 'picker'
  return 'manual'
}

/** Per-model context length and max output, for ORDER and other custom endpoints. */
export function showsEndpointModelLimits(input: {
  isCustomEndpointForm: boolean
  isBedrock: boolean
  selectedModelCount: number
}): boolean {
  return input.isCustomEndpointForm && !input.isBedrock && input.selectedModelCount > 0
}

/**
 * Bedrock uses the same checkbox catalog as other Pi providers when the SDK
 * list is available. An empty list keeps the comma-separated field.
 */
export function bedrockModelFieldMode(input: {
  loading: boolean
  catalogCount: number
}): 'picker' | 'manual' {
  return input.loading || input.catalogCount > 0 ? 'picker' : 'manual'
}
