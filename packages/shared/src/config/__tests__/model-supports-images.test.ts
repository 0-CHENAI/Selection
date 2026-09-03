import { describe, expect, it } from 'bun:test'
import {
  modelSupportsImages,
  resolveConnectionModelContextWindow,
  toCustomEndpointModelPayload,
  type LlmConnection,
} from '../llm-connections.ts'

const BASE_COMPAT: LlmConnection = {
  slug: 'custom',
  name: 'Custom',
  providerType: 'pi_compat',
  authType: 'api_key_with_endpoint',
  baseUrl: 'http://localhost:8080',
  customEndpoint: { api: 'openai-completions' },
  createdAt: 1,
}

describe('modelSupportsImages — pi_compat precedence', () => {
  it('returns true when per-model supportsImages: true (override wins over connection default)', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      customEndpoint: { api: 'openai-completions', supportsImages: false },
      models: [{ id: 'vision', supportsImages: true } as never],
    }
    expect(modelSupportsImages(conn, 'vision')).toBe(true)
  })

  it('returns false when per-model supportsImages: false (override wins over connection default true)', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      models: [{ id: 'text-only', supportsImages: false } as never],
    }
    expect(modelSupportsImages(conn, 'text-only')).toBe(false)
  })

  it('falls back to connection-level supportsImages when no per-model override', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      models: ['plain'],
    }
    expect(modelSupportsImages(conn, 'plain')).toBe(true)
  })

  it('returns false when neither per-model override nor connection default is set', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['plain'] }
    expect(modelSupportsImages(conn, 'plain')).toBe(false)
  })

  it('returns false when the model is not in models[] (matches Pi default)', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['plain'] }
    expect(modelSupportsImages(conn, 'unknown')).toBe(false)
  })

  it('returns connection default when the model is missing but connection default is true', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      models: ['plain'],
    }
    expect(modelSupportsImages(conn, 'unknown')).toBe(true)
  })

  it('matches stored Opus against runtime pi/ and custom-endpoint/ IDs', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      models: [{ id: 'Opus', supportsImages: true } as never],
    }
    expect(modelSupportsImages(conn, 'pi/Opus')).toBe(true)
    expect(modelSupportsImages(conn, 'custom-endpoint/Opus')).toBe(true)
    expect(modelSupportsImages(conn, 'opus')).toBe(true)
  })

  it('honors an explicit false even when the runtime ID is prefixed', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      models: [{ id: 'Opus', supportsImages: false } as never],
    }
    expect(modelSupportsImages(conn, 'pi/Opus')).toBe(false)
  })

  it('infers vision for well-known names when no explicit flag is stored', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['Opus'] }
    expect(modelSupportsImages(conn, 'pi/Opus')).toBe(true)
  })

  it('infers vision for ORDER Laufry when no explicit flag is stored', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['Laufry'] }
    expect(modelSupportsImages(conn, 'Laufry')).toBe(true)
    expect(modelSupportsImages(conn, 'pi/Laufry')).toBe(true)
  })

  it('does not infer vision for unknown ORDER names', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['Maylo'] }
    expect(modelSupportsImages(conn, 'Maylo')).toBe(false)
  })

  it('does not treat octopus, omnibox, or vllm names as vision', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['octopus', 'omnibox', 'foo-vllm'] }
    expect(modelSupportsImages(conn, 'octopus')).toBe(false)
    expect(modelSupportsImages(conn, 'omnibox')).toBe(false)
    expect(modelSupportsImages(conn, 'foo-vllm')).toBe(false)
  })
})

describe('toCustomEndpointModelPayload', () => {
  it('leaves inferred vision names as a bare id so connection defaults stay authoritative', () => {
    expect(toCustomEndpointModelPayload('Opus')).toBe('Opus')
  })

  it('leaves unknown names as a bare string', () => {
    expect(toCustomEndpointModelPayload('Laufry')).toBe('Laufry')
  })

  it('forwards an explicit true', () => {
    expect(toCustomEndpointModelPayload({ id: 'Opus', supportsImages: true })).toEqual({
      id: 'Opus',
      supportsImages: true,
    })
  })

  it('preserves an explicit false over the name heuristic', () => {
    expect(toCustomEndpointModelPayload({ id: 'Opus', supportsImages: false })).toEqual({
      id: 'Opus',
      supportsImages: false,
    })
  })

  it('does not write inferred false when only a context window is present', () => {
    expect(toCustomEndpointModelPayload({ id: 'Laufry', contextWindow: 200_000 })).toEqual({
      id: 'Laufry',
      contextWindow: 200_000,
    })
  })

  it('forwards stored context and maximum output limits', () => {
    expect(toCustomEndpointModelPayload({
      id: 'Maylo',
      contextWindow: 262_144,
      maxTokens: 32_768,
    })).toEqual({
      id: 'Maylo',
      contextWindow: 262_144,
      maxTokens: 32_768,
    })
  })
})

describe('resolveConnectionModelContextWindow', () => {
  it('reads a stored catalog window and matches prefixed runtime IDs', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      models: [{ id: 'DeepSeek-V4-Flash', contextWindow: 262_144 } as never],
    }
    expect(resolveConnectionModelContextWindow(conn, 'custom-endpoint/DeepSeek-V4-Flash')).toBe(262_144)
    expect(resolveConnectionModelContextWindow(conn, 'pi/DeepSeek-V4-Flash')).toBe(262_144)
  })

  it('returns undefined when the catalog has no window', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['Opus'] }
    expect(resolveConnectionModelContextWindow(conn, 'Opus')).toBeUndefined()
    expect(resolveConnectionModelContextWindow(null, 'Opus')).toBeUndefined()
  })
})

describe('modelSupportsImages — non-pi_compat fallthrough', () => {
  it('returns true for anthropic regardless of override (renderer does not gate built-in catalogs)', () => {
    const conn: LlmConnection = {
      slug: 'a', name: 'a', providerType: 'anthropic', authType: 'api_key',
      models: [{ id: 'claude-haiku', supportsImages: false } as never],
      createdAt: 1,
    }
    expect(modelSupportsImages(conn, 'claude-haiku')).toBe(true)
  })

  it('returns true for pi regardless of override', () => {
    const conn: LlmConnection = {
      slug: 'p', name: 'p', providerType: 'pi', authType: 'api_key',
      models: [{ id: 'gpt-x', supportsImages: false } as never],
      createdAt: 1,
    }
    expect(modelSupportsImages(conn, 'gpt-x')).toBe(true)
  })
})
