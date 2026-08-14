import { describe, expect, test } from 'bun:test'
import {
  inferModelSupportsImages,
  modelsEndpoint,
  parseOpenAiModelsPayload,
  parseSelectedModels,
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
})

describe('inferModelSupportsImages', () => {
  test('treats Claude / GPT-4o style names as multimodal', () => {
    expect(inferModelSupportsImages('Opus')).toBe(true)
    expect(inferModelSupportsImages('claude-sonnet-4-6')).toBe(true)
    expect(inferModelSupportsImages('gpt-4o-mini')).toBe(true)
  })

  test('leaves unknown ORDER names as text-only', () => {
    expect(inferModelSupportsImages('Laufry')).toBe(false)
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
})
