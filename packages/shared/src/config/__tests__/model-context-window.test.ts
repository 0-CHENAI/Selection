import { describe, expect, it } from 'bun:test'
import { parseOpenAiModelsPayload } from '../provider-model-payload.ts'
import {
  lookupKnownModelContextWindow,
  resolveApiKeyModelContextWindow,
  resolveRuntimeModelContextWindow,
  SAFE_MODEL_CONTEXT_WINDOW,
  withResolvedContextWindow,
} from '../model-context-window.ts'
import { resolveConnectionModelContextWindow } from '../llm-connections.ts'
import type { LlmConnection } from '../llm-connections.ts'

const BASE = {
  slug: 'custom',
  name: 'Custom',
  providerType: 'pi_compat',
  authType: 'api_key',
  createdAt: 0,
} as LlmConnection

describe('API key context windows', () => {
  it('reads sglang max_model_len and Anthropic max_input_tokens', () => {
    expect(parseOpenAiModelsPayload({
      object: 'list',
      data: [{
        id: 'MO',
        object: 'model',
        owned_by: 'sglang',
        max_model_len: 262144,
      }],
    })).toEqual([{ id: 'MO', name: 'MO', contextWindow: 262144 }])

    expect(parseOpenAiModelsPayload({
      data: [{ id: 'claude-sonnet', max_input_tokens: 200000 }],
    })[0]?.contextWindow).toBe(200000)

    expect(parseOpenAiModelsPayload({
      data: [{ id: 'gateway-model', context_length: 131072 }],
    })[0]?.contextWindow).toBe(131072)
  })

  it('prefers a manual override, then endpoint metadata, then a known preset', () => {
    expect(resolveApiKeyModelContextWindow({
      manual: 32768,
      endpoint: 262144,
      known: 1_000_000,
      fallback: SAFE_MODEL_CONTEXT_WINDOW,
    })).toBe(32768)
    expect(resolveApiKeyModelContextWindow({
      endpoint: 262144,
      known: 1_000_000,
      fallback: SAFE_MODEL_CONTEXT_WINDOW,
    })).toBe(262144)
    expect(resolveApiKeyModelContextWindow({
      known: lookupKnownModelContextWindow('deepseek-v4-flash'),
      fallback: SAFE_MODEL_CONTEXT_WINDOW,
    })).toBe(1_000_000)
    expect(resolveApiKeyModelContextWindow({
      fallback: SAFE_MODEL_CONTEXT_WINDOW,
    })).toBe(SAFE_MODEL_CONTEXT_WINDOW)
  })

  it('fills a stored string id from the known preset table without inventing a window for Opus', () => {
    expect(withResolvedContextWindow('deepseek-v4-pro')).toEqual({
      id: 'deepseek-v4-pro',
      contextWindow: 1_000_000,
      maxTokens: 384_000,
    })
    expect(withResolvedContextWindow('kimi-k2.6')).toMatchObject({ contextWindow: 262_144 })
    expect(withResolvedContextWindow('Opus')).toBe('Opus')
    expect(resolveConnectionModelContextWindow({
      ...BASE,
      models: ['deepseek-flash'],
    }, 'pi/deepseek-flash')).toBe(1_000_000)
    expect(resolveConnectionModelContextWindow({
      ...BASE,
      models: ['Opus'],
    }, 'Opus')).toBeUndefined()
  })

  it('keeps a stored catalog window ahead of the known preset', () => {
    expect(resolveConnectionModelContextWindow({
      ...BASE,
      models: [{ id: 'DeepSeek-V4-Flash', contextWindow: 262_144 } as never],
    }, 'custom-endpoint/DeepSeek-V4-Flash')).toBe(262_144)
  })

  it('uses the registry before the safe default, and the default when nothing matches', () => {
    expect(resolveRuntimeModelContextWindow({
      modelId: 'claude-opus-4-8',
      registry: 1_000_000,
    })).toBe(1_000_000)
    expect(resolveRuntimeModelContextWindow({
      modelId: 'MO',
    })).toBe(SAFE_MODEL_CONTEXT_WINDOW)
    expect(resolveRuntimeModelContextWindow({
      modelId: 'MO',
      endpoint: 262144,
    })).toBe(262144)
    expect(resolveRuntimeModelContextWindow({ modelId: '' })).toBeUndefined()
  })
})
