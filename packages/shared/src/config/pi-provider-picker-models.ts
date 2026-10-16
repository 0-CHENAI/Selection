/**
 * Models shown in the Pi API-key model picker.
 *
 * OpenRouter is fetched live. Every other provider still uses the Pi SDK
 * snapshot because those catalogs are first-party and change with app upgrades.
 */

import { getModels } from '@earendil-works/pi-ai/compat'
import {
  fetchOpenRouterCatalog,
  formatPiProviderPickerModels,
  type PiProviderPickerModel,
} from './openrouter-catalog.ts'
import { toPiProviderId } from './pi-provider-ids.ts'

export type { PiProviderPickerModel }

function sdkModelsForProvider(provider: string): PiProviderPickerModel[] {
  const models = getModels(toPiProviderId(provider) as Parameters<typeof getModels>[0])
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    costInput: model.cost.input,
    costOutput: model.cost.output,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
  }))
}

/**
 * Bare Bedrock Claude ids (`anthropic.claude-…`) are rejected by Bedrock.
 * Regional inference profiles (`us.` / `eu.` / `global.` / …) stay selectable.
 */
export function isBareBedrockClaudePickerId(modelId: string): boolean {
  const raw = modelId.startsWith('pi/') ? modelId.slice(3) : modelId
  return raw.startsWith('anthropic.claude-')
}

function pickerModelsForProvider(provider: string): PiProviderPickerModel[] {
  const models = sdkModelsForProvider(provider)
  if (provider !== 'amazon-bedrock') return models
  return models.filter((model) => !isBareBedrockClaudePickerId(model.id))
}

export async function listPiProviderPickerModels(
  provider: string,
  options: {
    fetchOpenRouter?: typeof fetchOpenRouterCatalog
  } = {},
): Promise<{ models: PiProviderPickerModel[]; totalCount: number }> {
  if (provider === 'openrouter') {
    try {
      const fetchCatalog = options.fetchOpenRouter ?? fetchOpenRouterCatalog
      const live = await fetchCatalog()
      if (live.length > 0) return formatPiProviderPickerModels(live)
    } catch {
      // Keep the bundled snapshot if OpenRouter is unreachable.
    }
  }

  try {
    return formatPiProviderPickerModels(pickerModelsForProvider(provider))
  } catch {
    return { models: [], totalCount: 0 }
  }
}
