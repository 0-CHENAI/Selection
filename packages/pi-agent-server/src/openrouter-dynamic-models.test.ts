import { describe, expect, it } from 'bun:test'
import {
  buildOpenRouterDynamicModel,
  registerMissingOpenRouterModels,
  type OpenRouterModelRegistry,
} from './openrouter-dynamic-models.ts'

function createRegistry(
  models: Array<{ id: string; provider?: string }>,
): OpenRouterModelRegistry & { registered?: unknown } {
  const store = models.map((model) => ({
    id: model.id,
    name: model.id,
    provider: model.provider ?? 'openrouter',
    api: 'openai-completions' as const,
    reasoning: false,
    input: ['text'] as Array<'text' | 'image'>,
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  }))

  const registry: OpenRouterModelRegistry & { registered?: unknown } = {
    find(provider, modelId) {
      return store.find((model) => model.provider === provider && model.id === modelId)
    },
    getAll() {
      return store
    },
    registerProvider(providerName, config) {
      registry.registered = { providerName, config }
    },
  }
  return registry
}

describe('buildOpenRouterDynamicModel', () => {
  it('uses catalog overrides and OpenRouter completions compat', () => {
    expect(buildOpenRouterDynamicModel({
      id: 'openai/gpt-new',
      contextWindow: 200_000,
      supportsImages: true,
    })).toMatchObject({
      id: 'openai/gpt-new',
      api: 'openai-completions',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 200_000,
      maxTokens: 32_768,
      compat: { supportsDeveloperRole: false, thinkingFormat: 'openrouter' },
    })
  })
})

describe('registerMissingOpenRouterModels', () => {
  it('does nothing when every id is already in the OpenRouter catalog', () => {
    const registry = createRegistry([{ id: 'openrouter/auto' }])
    expect(registerMissingOpenRouterModels(
      registry,
      [{ id: 'pi/openrouter/auto' }],
      'sk-or-test',
    )).toEqual([])
    expect(registry.registered).toBeUndefined()
  })

  it('re-registers OpenRouter with existing models plus the missing live id', () => {
    const registry = createRegistry([{ id: 'openrouter/auto' }])
    const added = registerMissingOpenRouterModels(
      registry,
      [{ id: 'pi/openai/gpt-brand-new' }, { id: 'openrouter/auto' }],
      'sk-or-test',
    )

    expect(added).toEqual(['openai/gpt-brand-new'])
    expect(registry.registered).toMatchObject({
      providerName: 'openrouter',
      config: {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-test',
        api: 'openai-completions',
      },
    })
    const models = (registry.registered as { config: { models: Array<{ id: string }> } }).config.models
    expect(models.map((model) => model.id)).toEqual(['openrouter/auto', 'openai/gpt-brand-new'])
  })

  it('skips registration without an API key', () => {
    const registry = createRegistry([])
    expect(registerMissingOpenRouterModels(registry, [{ id: 'openai/gpt-new' }], '  ')).toEqual([])
    expect(registry.registered).toBeUndefined()
  })
})
