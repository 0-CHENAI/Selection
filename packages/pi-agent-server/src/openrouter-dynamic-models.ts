import type { Api, Model } from '@earendil-works/pi-ai';
import { inferModelSupportsImages } from '../../shared/src/config/model-image-support.ts';
import { OPENROUTER_API_BASE_URL } from '../../shared/src/config/openrouter-catalog.ts';
import {
  stripPiPrefix,
  type CustomEndpointModelEntry,
} from './custom-endpoint-models.ts';

type OpenRouterProviderModel = {
  id: string
  name: string
  api?: Api
  baseUrl?: string
  reasoning: boolean
  thinkingLevelMap?: Model<Api>['thinkingLevelMap']
  input: Array<'text' | 'image'>
  cost: Model<Api>['cost']
  contextWindow: number
  maxTokens: number
  compat?: Model<Api>['compat']
}

type OpenRouterRegistryModel = OpenRouterProviderModel & {
  provider?: string
}

export interface OpenRouterModelRegistry {
  find(provider: string, modelId: string): { id: string } | undefined
  getAll(): OpenRouterRegistryModel[]
  registerProvider(providerName: string, config: {
    baseUrl: string
    apiKey: string
    api: Api
    authHeader: boolean
    models: OpenRouterProviderModel[]
  }): void
}

const OPENROUTER_COMPAT = {
  supportsDeveloperRole: false,
  thinkingFormat: 'openrouter',
} as const

function toProviderModel(model: OpenRouterRegistryModel): OpenRouterProviderModel {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    compat: model.compat,
  }
}

export function buildOpenRouterDynamicModel(
  entry: CustomEndpointModelEntry,
): OpenRouterProviderModel {
  const supportsImages = entry.supportsImages ?? inferModelSupportsImages(entry.id)
  const contextWindow = entry.contextWindow ?? 131_072
  return {
    id: entry.id,
    name: entry.id,
    api: 'openai-completions',
    baseUrl: OPENROUTER_API_BASE_URL,
    reasoning: false,
    input: supportsImages ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(contextWindow, 32_768),
    compat: OPENROUTER_COMPAT,
  }
}

/**
 * Pi's OpenRouter catalog is a generated snapshot. Register selected IDs that
 * are missing so a live OpenRouter model can still stream through the same
 * provider auth/base URL. registerProvider replaces the provider, so existing
 * OpenRouter models are copied forward.
 */
export function registerMissingOpenRouterModels(
  registry: OpenRouterModelRegistry,
  entries: CustomEndpointModelEntry[],
  apiKey: string,
): string[] {
  if (!apiKey.trim()) return []

  const missing = entries
    .map((entry) => ({ ...entry, id: stripPiPrefix(entry.id) }))
    .filter((entry) => entry.id && !registry.find('openrouter', entry.id))

  if (missing.length === 0) return []

  const existing = registry
    .getAll()
    .filter((model) => model.provider === 'openrouter')
    .map(toProviderModel)

  const added = missing.map(buildOpenRouterDynamicModel)
  registry.registerProvider('openrouter', {
    baseUrl: OPENROUTER_API_BASE_URL,
    apiKey,
    api: 'openai-completions',
    authHeader: true,
    models: [...existing, ...added],
  })
  return added.map((model) => model.id)
}
