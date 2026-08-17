import { describe, expect, test } from 'bun:test'
import {
  firstSelectedModelId,
  inferModelSupportsImages,
  modelsEndpoint,
  parseOpenAiModelsPayload,
  parseSelectedModels,
  resolveRemoteModelSupportsImages,
  toggleSelectedModel,
} from '../fetch-openai-models.ts'

describe('modelsEndpoint', () => {
  test('appends /v1/models when base has no version suffix', () => {
    expect(modelsEndpoint('https://order.ai.jxepdi.top')).toBe(
      'https://order.ai.jxepdi.top/v1/models',
    )
  })

  test('does not double /v1 when base already ends with /v1', () => {
    expect(modelsEndpoint('https://order.ai.jxepdi.top/v1')).toBe(
      'https://order.ai.jxepdi.top/v1/models',
    )
  })

  test('strips trailing slashes', () => {
    expect(modelsEndpoint('https://order.ai.jxepdi.top/v1/')).toBe(
      'https://order.ai.jxepdi.top/v1/models',
    )
  })
})

describe('parseOpenAiModelsPayload', () => {
  test('reads OpenAI { data: [{ id }] } shape', () => {
    expect(parseOpenAiModelsPayload({
      data: [{ id: 'Opus' }, { id: 'Laufry', name: 'Laufry' }, { id: 'Maylo' }],
    })).toEqual([
      { id: 'Opus', name: 'Opus' },
      { id: 'Laufry', name: 'Laufry' },
      { id: 'Maylo', name: 'Maylo' },
    ])
  })

  test('reads a bare array and prefers display_name', () => {
    expect(parseOpenAiModelsPayload([
      { id: 'opus', display_name: 'Opus' },
    ])).toEqual([{ id: 'opus', name: 'Opus' }])
  })

  test('dedupes ids and skips empty rows', () => {
    expect(parseOpenAiModelsPayload({
      data: [{ id: 'Opus' }, { id: 'Opus' }, { name: '' }, null],
    })).toEqual([{ id: 'Opus', name: 'Opus' }])
  })

  test('honors declared vision flags over the name heuristic', () => {
    expect(parseOpenAiModelsPayload({
      data: [
        { id: 'Laufry', architecture: { input_modalities: ['text', 'image'] } },
        { id: 'Opus', supports_vision: false },
      ],
    })).toEqual([
      { id: 'Laufry', name: 'Laufry', supportsImages: true },
      { id: 'Opus', name: 'Opus', supportsImages: false },
    ])
  })

  test('reads catalog context windows from common field names', () => {
    expect(parseOpenAiModelsPayload({
      data: [
        { id: 'Opus', context_window: 200_000 },
        { id: 'Laufry', context_length: '131072' },
        { id: 'Maylo', model_info: { max_input_tokens: 262_144 } },
        { id: 'tiny', context_window: 16 },
      ],
    })).toEqual([
      { id: 'Opus', name: 'Opus', contextWindow: 200_000 },
      { id: 'Laufry', name: 'Laufry', contextWindow: 131_072 },
      { id: 'Maylo', name: 'Maylo', contextWindow: 262_144 },
      { id: 'tiny', name: 'tiny' },
    ])
  })

  test('reads LiteLLM model_info and OpenAI modalities arrays', () => {
    expect(parseOpenAiModelsPayload({
      data: [
        { id: 'Maylo', model_info: { supports_vision: true } },
        { id: 'text-1', modalities: ['text'] },
        { id: 'vision-1', modalities: [{ type: 'text' }, { type: 'image_url' }] },
      ],
    })).toEqual([
      { id: 'Maylo', name: 'Maylo', supportsImages: true },
      { id: 'text-1', name: 'text-1', supportsImages: false },
      { id: 'vision-1', name: 'vision-1', supportsImages: true },
    ])
  })
})

describe('resolveRemoteModelSupportsImages', () => {
  test('uses catalog or user override, never the model name', () => {
    expect(resolveRemoteModelSupportsImages({ id: 'Opus', name: 'Opus' })).toBe(false)
    expect(resolveRemoteModelSupportsImages({ id: 'Laufry', name: 'Laufry' })).toBe(false)
    expect(resolveRemoteModelSupportsImages({ id: 'Laufry', name: 'Laufry', supportsImages: true })).toBe(true)
    expect(resolveRemoteModelSupportsImages({ id: 'Opus', name: 'Opus', supportsImages: false })).toBe(false)
  })

  test('user override wins over catalog', () => {
    expect(resolveRemoteModelSupportsImages({ id: 'Laufry', name: 'Laufry' }, true)).toBe(true)
    expect(resolveRemoteModelSupportsImages({ id: 'Opus', name: 'Opus', supportsImages: true }, false)).toBe(false)
  })
})

describe('inferModelSupportsImages', () => {
  test('treats Claude / GPT-4o style names as multimodal', () => {
    expect(inferModelSupportsImages('Opus')).toBe(true)
    expect(inferModelSupportsImages('claude-sonnet-4-6')).toBe(true)
    expect(inferModelSupportsImages('gpt-4o-mini')).toBe(true)
  })

  test('treats ORDER Laufry as multimodal even without a catalog flag', () => {
    expect(inferModelSupportsImages('Laufry')).toBe(true)
    expect(inferModelSupportsImages('pi/Laufry')).toBe(true)
  })

  test('leaves unknown ORDER names as text-only', () => {
    expect(inferModelSupportsImages('Maylo')).toBe(false)
  })

  test('does not match octopus, omnibox, or vllm as vision names', () => {
    expect(inferModelSupportsImages('octopus')).toBe(false)
    expect(inferModelSupportsImages('omnibox')).toBe(false)
    expect(inferModelSupportsImages('foo-vllm')).toBe(false)
  })
})

describe('toggleSelectedModel', () => {
  test('adds then removes while preserving order', () => {
    const once = toggleSelectedModel('', 'Opus')
    expect(parseSelectedModels(once)).toEqual(['Opus'])
    const twice = toggleSelectedModel(once, 'Laufry')
    expect(parseSelectedModels(twice)).toEqual(['Opus', 'Laufry'])
    expect(parseSelectedModels(toggleSelectedModel(twice, 'Opus'))).toEqual(['Laufry'])
  })

  test('splits fullwidth and enumeration commas used in zh placeholders', () => {
    expect(parseSelectedModels('Opus，Laufry、Maylo')).toEqual(['Opus', 'Laufry', 'Maylo'])
  })

  test('firstSelectedModelId never returns a joined list', () => {
    expect(firstSelectedModelId('Opus, Laufry')).toBe('Opus')
    expect(firstSelectedModelId('Opus，Laufry')).toBe('Opus')
    expect(firstSelectedModelId('')).toBeUndefined()
  })
})
