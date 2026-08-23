import { describe, expect, it } from 'bun:test'
import {
  fetchOpenRouterCatalog,
  formatPiProviderPickerModels,
  parseOpenRouterModelsPayload,
} from '../openrouter-catalog.ts'
import { listPiProviderPickerModels } from '../pi-provider-picker-models.ts'

const LIVE_PAYLOAD = {
  data: [
    {
      id: 'openai/gpt-5.4-pro',
      name: 'OpenAI: GPT-5.4 Pro',
      context_length: 400000,
      pricing: { prompt: '0.000003', completion: '0.000012' },
      architecture: { modality: 'text+image->text', output_modalities: ['text'] },
      supported_parameters: ['temperature', 'reasoning'],
    },
    {
      id: 'qwen/qwen3.6-27b',
      name: 'Qwen: Qwen3.6 27B',
      context_length: 262144,
      pricing: { prompt: '0.0000001', completion: '0.0000002' },
      architecture: { output_modalities: ['text'] },
    },
    {
      id: 'openai/text-embedding-3-large',
      name: 'OpenAI: Text Embedding 3 Large',
      architecture: { output_modalities: ['embeddings'] },
    },
    {
      id: 'openai/gpt-5.4-pro',
      name: 'duplicate',
    },
  ],
}

describe('parseOpenRouterModelsPayload', () => {
  it('keeps text chat models, converts per-token prices, and drops embeddings', () => {
    expect(parseOpenRouterModelsPayload(LIVE_PAYLOAD)).toEqual([
      {
        id: 'openai/gpt-5.4-pro',
        name: 'OpenAI: GPT-5.4 Pro',
        costInput: 3,
        costOutput: 12,
        contextWindow: 400000,
        reasoning: true,
      },
      {
        id: 'qwen/qwen3.6-27b',
        name: 'Qwen: Qwen3.6 27B',
        costInput: 0.1,
        costOutput: 0.2,
        contextWindow: 262144,
        reasoning: false,
      },
    ])
  })

  it('drops models past their expiration date', () => {
    expect(parseOpenRouterModelsPayload({
      data: [
        { id: 'dead/model', name: 'Dead', expiration_date: '2020-01-01', architecture: { output_modalities: ['text'] } },
        { id: 'kept/chat', name: 'Kept', architecture: { output_modalities: ['text'] } },
      ],
    }).map((model) => model.id)).toEqual(['kept/chat'])
  })

  it('skips rerank/embedding modalities when output_modalities is absent', () => {
    expect(parseOpenRouterModelsPayload({
      data: [
        { id: 'cohere/rerank-v3.5', architecture: { modality: 'text->rerank' } },
        { id: 'kept/chat', name: 'Kept', architecture: { modality: 'text->text' } },
      ],
    })).toEqual([
      {
        id: 'kept/chat',
        name: 'Kept',
        costInput: 0,
        costOutput: 0,
        contextWindow: 131072,
        reasoning: false,
      },
    ])
  })
})

describe('formatPiProviderPickerModels', () => {
  it('prefixes Craft ids and sorts expensive-first', () => {
    const formatted = formatPiProviderPickerModels([
      { id: 'cheap/model', name: 'Cheap', costInput: 0.1, costOutput: 0.2, contextWindow: 8_000, reasoning: false },
      { id: 'pi/pricey/model', name: 'Pricey', costInput: 5, costOutput: 20, contextWindow: 200_000, reasoning: true },
    ])
    expect(formatted.totalCount).toBe(2)
    expect(formatted.models.map((model) => model.id)).toEqual([
      'pi/pricey/model',
      'pi/cheap/model',
    ])
  })
})

describe('fetchOpenRouterCatalog', () => {
  it('GETs the public models endpoint and parses the payload', async () => {
    const urls: string[] = []
    const models = await fetchOpenRouterCatalog({
      apiKey: ' sk-or-test ',
      fetchImpl: async (input, init) => {
        urls.push(input)
        expect(init?.headers).toEqual({
          Accept: 'application/json',
          Authorization: 'Bearer sk-or-test',
        })
        return new Response(JSON.stringify(LIVE_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    expect(urls).toEqual(['https://openrouter.ai/api/v1/models'])
    expect(models.map((model) => model.id)).toEqual([
      'openai/gpt-5.4-pro',
      'qwen/qwen3.6-27b',
    ])
  })

  it('throws on a non-OK response', async () => {
    await expect(fetchOpenRouterCatalog({
      fetchImpl: async () => new Response('nope', { status: 403 }),
    })).rejects.toThrow('openrouter_models_http_403')
  })
})

describe('listPiProviderPickerModels', () => {
  it('prefers the live OpenRouter catalog', async () => {
    const result = await listPiProviderPickerModels('openrouter', {
      fetchOpenRouter: async () => parseOpenRouterModelsPayload(LIVE_PAYLOAD),
    })
    expect(result.models.map((model) => model.id)).toEqual([
      'pi/openai/gpt-5.4-pro',
      'pi/qwen/qwen3.6-27b',
    ])
    expect(result.models[0]?.name).toBe('OpenAI: GPT-5.4 Pro')
  })

  it('falls back to the Pi SDK snapshot when the live fetch fails', async () => {
    const result = await listPiProviderPickerModels('openrouter', {
      fetchOpenRouter: async () => {
        throw new Error('offline')
      },
    })
    expect(result.totalCount).toBeGreaterThan(0)
    expect(result.models.some((model) => model.id === 'pi/openrouter/auto')).toBe(true)
  })

  it('falls back when the live catalog is empty', async () => {
    const result = await listPiProviderPickerModels('openrouter', {
      fetchOpenRouter: async () => [],
    })
    expect(result.totalCount).toBeGreaterThan(0)
    expect(result.models.some((model) => model.id === 'pi/openrouter/auto')).toBe(true)
  })
})
