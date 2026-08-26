import { describe, expect, test } from 'bun:test'
import {
  findRemoteModel,
  firstSelectedModelId,
  inferModelSupportsImages,
  lookupRecordByModelId,
  modelsEndpoint,
  parseOpenAiModelsPayload,
  parseSelectedModels,
  persistCustomContextWindow,
  persistCustomMaxTokens,
  resolveCatalogOrOverrideLimit,
  resolveModelLimitSource,
  resolveModelLimitsStatus,
  resolveRemoteModelSupportsImages,
  setHasModelId,
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

  test('reads catalog max output tokens from specific field names only', () => {
    expect(parseOpenAiModelsPayload({
      data: [
        { id: 'Opus', max_output_tokens: 65_536 },
        { id: 'Laufry', max_completion_tokens: '32768' },
        { id: 'Maylo', info: { max_output_tokens: 16_384 } },
        { id: 'generic', max_tokens: 8_192 },
        { id: 'tiny', max_output_tokens: 16 },
        { id: 'clamped', context_window: 4_096, max_output_tokens: 65_536 },
      ],
    })).toEqual([
      { id: 'Opus', name: 'Opus', maxTokens: 65_536 },
      { id: 'Laufry', name: 'Laufry', maxTokens: 32_768 },
      { id: 'Maylo', name: 'Maylo', maxTokens: 16_384 },
      { id: 'generic', name: 'generic' },
      { id: 'tiny', name: 'tiny' },
      { id: 'clamped', name: 'clamped', contextWindow: 4_096, maxTokens: 4_096 },
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

describe('findRemoteModel', () => {
  test('matches catalog ids with runtime prefixes and case', () => {
    const models = [{ id: 'Opus', name: 'Opus', contextWindow: 200_000 }]
    expect(findRemoteModel(models, 'pi/Opus')?.contextWindow).toBe(200_000)
    expect(findRemoteModel(models, 'opus')?.id).toBe('Opus')
    expect(findRemoteModel(models, 'Maylo')).toBeUndefined()
  })
})

describe('resolveCatalogOrOverrideLimit', () => {
  test('uses catalog when nothing was edited and the saved value is the default', () => {
    expect(resolveCatalogOrOverrideLimit({
      edited: false,
      override: 8_192,
      catalog: 32_768,
      fallback: 8_192,
    })).toBe(32_768)
  })

  test('keeps a saved custom value when it is not the default or catalog', () => {
    expect(resolveCatalogOrOverrideLimit({
      edited: false,
      override: 16_384,
      catalog: 32_768,
      fallback: 8_192,
    })).toBe(16_384)
  })

  test('keeps this-session edits even when they match the default', () => {
    expect(resolveCatalogOrOverrideLimit({
      edited: true,
      override: 8_192,
      catalog: 32_768,
      fallback: 8_192,
    })).toBe(8_192)
  })

  test('falls back when the catalog is missing', () => {
    expect(resolveCatalogOrOverrideLimit({
      edited: false,
      fallback: 8_192,
    })).toBe(8_192)
  })
})

describe('resolveModelLimitSource', () => {
  test('labels catalog, default, and manual values', () => {
    expect(resolveModelLimitSource({
      edited: false,
      catalog: 32_768,
      displayed: 32_768,
      fallback: 8_192,
    })).toBe('catalog')
    expect(resolveModelLimitSource({
      edited: false,
      displayed: 8_192,
      fallback: 8_192,
    })).toBe('default')
    expect(resolveModelLimitSource({
      edited: true,
      override: 16_384,
      catalog: 32_768,
      displayed: 16_384,
      fallback: 8_192,
    })).toBe('manual')
  })

  test('keeps default when a default max is only clamped by a smaller context', () => {
    expect(resolveModelLimitSource({
      edited: false,
      override: 8_192,
      displayed: 4_096,
      fallback: 8_192,
    })).toBe('default')
  })
})

describe('lookupRecordByModelId', () => {
  test('matches saved keys with runtime prefixes and case', () => {
    const windows = { Opus: 200_000 }
    expect(lookupRecordByModelId(windows, 'pi/Opus')).toBe(200_000)
    expect(lookupRecordByModelId(windows, 'opus')).toBe(200_000)
    expect(lookupRecordByModelId(windows, 'Laufry')).toBeUndefined()
  })
})

describe('setHasModelId', () => {
  test('matches edited ids with case and prefixes', () => {
    expect(setHasModelId(new Set(['Opus']), 'pi/opus')).toBe(true)
    expect(setHasModelId(new Set(['Opus']), 'Laufry')).toBe(false)
  })
})

describe('persistCustomContextWindow', () => {
  test('clamps below-min drafts to the minimum instead of the default', () => {
    expect(persistCustomContextWindow(512)).toBe(1_024)
    expect(persistCustomContextWindow(200_000)).toBe(200_000)
    expect(persistCustomContextWindow(Number.NaN)).toBe(131_072)
  })
})

describe('persistCustomMaxTokens', () => {
  test('clamps output to the context window and legal range', () => {
    expect(persistCustomMaxTokens(65_536, 4_096)).toBe(4_096)
    expect(persistCustomMaxTokens(100, 131_072)).toBe(256)
    expect(persistCustomMaxTokens(8_192, 131_072)).toBe(8_192)
  })
})

describe('resolveModelLimitsStatus', () => {
  test('prefers loading, then catalog, then fetch failure', () => {
    expect(resolveModelLimitsStatus({
      loading: true,
      catalogFilled: true,
      fetchFailed: false,
      hasKey: true,
    })).toBe('detecting')
    expect(resolveModelLimitsStatus({
      loading: false,
      catalogFilled: true,
      fetchFailed: false,
      hasKey: true,
    })).toBe('detected')
    expect(resolveModelLimitsStatus({
      loading: false,
      catalogFilled: false,
      fetchFailed: true,
      hasKey: true,
    })).toBe('unavailable')
    expect(resolveModelLimitsStatus({
      loading: false,
      catalogFilled: false,
      fetchFailed: false,
      hasKey: true,
    })).toBe('defaults')
    expect(resolveModelLimitsStatus({
      loading: false,
      catalogFilled: false,
      fetchFailed: false,
      hasKey: false,
    })).toBe('hint')
  })
})
