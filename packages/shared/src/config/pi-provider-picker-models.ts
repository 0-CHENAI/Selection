/**
 * Models shown in the Pi API-key 3-tier picker.
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

export type { PiProviderPickerModel }

function sdkModelsForProvider(provider: string): PiProviderPickerModel[] {
  const models = getModels(provider as Parameters<typeof getModels>[0])
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    costInput: model.cost.input,
    costOutput: model.cost.output,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
  }))
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
    return formatPiProviderPickerModels(sdkModelsForProvider(provider))
  } catch {
    return { models: [], totalCount: 0 }
  }
}
