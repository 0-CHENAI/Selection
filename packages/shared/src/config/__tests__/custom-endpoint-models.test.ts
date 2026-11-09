import { describe, expect, test } from 'bun:test'
import {
  anthropicCompatibleModelsUrl,
  fetchCustomEndpointModels,
  customEndpointModelsBlockSave,
  customModelFieldMode,
  mergeFetchedModelSelection,
  modelListAuthHeaders,
  selectionAfterAutoFetch,
  openaiCompatibleModelsUrl,
  planCustomEndpointModelRequests,
  sameHostOpenAiModelsUrl,
} from '../custom-endpoint-models.ts'

const SECRET = 'sk-test-secret-value'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: { cancel: async () => {} },
  }
}

describe('custom endpoint model URLs', () => {
  test('OpenAI Compatible uses {base}/models when the base already ends in /v1', () => {
    expect(openaiCompatibleModelsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/models',
    )
    expect(openaiCompatibleModelsUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/models',
    )
  })

  test('OpenAI Compatible still targets /v1/models when the base omits /v1', () => {
    expect(openaiCompatibleModelsUrl('https://api.example.com')).toBe(
      'https://api.example.com/v1/models',
    )
  })

  test('Anthropic Compatible appends /v1/models without doubling /v1', () => {
    expect(anthropicCompatibleModelsUrl('https://api.kimi.com/coding')).toBe(
      'https://api.kimi.com/coding/v1/models',
    )
    expect(anthropicCompatibleModelsUrl('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/models',
    )
    expect(anthropicCompatibleModelsUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/models',
    )
    expect(anthropicCompatibleModelsUrl('https://api.anthropic.com/v1/')).toBe(
      'https://api.anthropic.com/v1/models',
    )
    expect(anthropicCompatibleModelsUrl('https://api.anthropic.com/v1/models')).toBe(
      'https://api.anthropic.com/v1/models',
    )
  })

  test('fallback is the same host /v1/models and is skipped when it matches the primary URL', () => {
    expect(sameHostOpenAiModelsUrl('https://api.kimi.com/coding')).toBe(
      'https://api.kimi.com/v1/models',
    )
    expect(planCustomEndpointModelRequests('https://api.kimi.com/coding', 'anthropic-messages')
      .map((attempt) => attempt.url)).toEqual([
      'https://api.kimi.com/coding/v1/models',
      'https://api.kimi.com/v1/models',
    ])
    expect(planCustomEndpointModelRequests('https://api.anthropic.com', 'anthropic-messages')
      .map((attempt) => attempt.source)).toEqual(['anthropic'])
    expect(planCustomEndpointModelRequests('https://api.openai.com/v1', 'openai-completions')
      .map((attempt) => attempt.source)).toEqual(['openai'])
  })

  test('rejects non-http bases', () => {
    expect(planCustomEndpointModelRequests('file:///tmp/models', 'openai-completions')).toEqual([])
    expect(planCustomEndpointModelRequests('', 'anthropic-messages')).toEqual([])
  })
})

describe('modelListAuthHeaders', () => {
  test('official Anthropic uses x-api-key and anthropic-version, not Bearer', () => {
    const headers = modelListAuthHeaders(
      'https://api.anthropic.com/v1/models',
      SECRET,
      'anthropic-messages',
    )
    expect(headers['x-api-key']).toBe(SECRET)
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.Authorization).toBeUndefined()
  })

  test('third-party Anthropic gateways use Bearer and drop x-api-key', () => {
    const headers = modelListAuthHeaders(
      'https://api.kimi.com/coding/v1/models',
      SECRET,
      'anthropic-messages',
    )
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['x-api-key']).toBeUndefined()
    const evil = modelListAuthHeaders(
      'https://api.anthropic.com.evil.example/v1/models',
      SECRET,
      'anthropic-messages',
    )
    expect(evil.Authorization).toBe(`Bearer ${SECRET}`)
    expect(evil['x-api-key']).toBeUndefined()
  })

  test('OpenAI Compatible and the fallback use Bearer only', () => {
    const headers = modelListAuthHeaders(
      'https://api.openai.com/v1/models',
      SECRET,
      'openai-completions',
    )
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers['anthropic-version']).toBeUndefined()
  })
})

describe('fetchCustomEndpointModels', () => {
  test('OpenAI Compatible sends one Bearer request and returns a sorted, deduped list', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const result = await fetchCustomEndpointModels({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: SECRET,
      api: 'openai-completions',
    }, {
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init?.headers ?? {} })
        return jsonResponse(200, {
          data: [
            { id: 'zeta' },
            { id: 'alpha' },
            { id: 'Alpha' },
            { id: 'pi/alpha', display_name: 'Alpha' },
          ],
        })
      },
    })
    expect(calls.map((call) => call.url)).toEqual(['https://api.openai.com/v1/models'])
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(result).toEqual({
      ok: true,
      source: 'openai',
      models: [
        { id: 'alpha', name: 'alpha' },
        { id: 'zeta', name: 'zeta' },
      ],
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  test('Anthropic falls back to the same host OpenAI /v1/models after a failed models route', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const result = await fetchCustomEndpointModels({
      baseUrl: 'https://api.kimi.com/coding',
      apiKey: SECRET,
      api: 'anthropic-messages',
    }, {
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init?.headers ?? {} })
        if (url.endsWith('/coding/v1/models')) return jsonResponse(404, { error: SECRET })
        return jsonResponse(200, {
          data: [{ id: 'kimi-k2', display_name: 'Kimi K2' }],
        })
      },
    })
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.kimi.com/coding/v1/models',
      'https://api.kimi.com/v1/models',
    ])
    expect(calls[0]?.headers['x-api-key']).toBeUndefined()
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(calls[1]?.headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(calls[1]?.headers['anthropic-version']).toBeUndefined()
    expect(result).toEqual({
      ok: true,
      source: 'openai-fallback',
      models: [{ id: 'kimi-k2', name: 'Kimi K2' }],
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  test('an empty Anthropic catalog is not treated as a failure', async () => {
    const urls: string[] = []
    const result = await fetchCustomEndpointModels({
      baseUrl: 'https://gateway.example/anthropic',
      apiKey: SECRET,
      api: 'anthropic-messages',
    }, {
      fetchImpl: async (url) => {
        urls.push(url)
        return jsonResponse(200, { data: [] })
      },
    })
    expect(urls).toEqual(['https://gateway.example/anthropic/v1/models'])
    expect(result).toEqual({ ok: true, source: 'anthropic', models: [] })
  })

  test('official Anthropic does not retry the same URL and does not leak the key', async () => {
    const urls: string[] = []
    const result = await fetchCustomEndpointModels({
      baseUrl: 'https://api.anthropic.com',
      apiKey: SECRET,
      api: 'anthropic-messages',
    }, {
      fetchImpl: async (url, init) => {
        urls.push(url)
        expect(init?.headers?.['x-api-key']).toBe(SECRET)
        expect(init?.headers?.Authorization).toBeUndefined()
        throw new Error(`network down ${SECRET}`)
      },
    })
    expect(urls).toEqual(['https://api.anthropic.com/v1/models'])
    expect(result).toEqual({ ok: false, error: 'unavailable' })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  test('both routes failing keeps a friendly unavailable result', async () => {
    const result = await fetchCustomEndpointModels({
      baseUrl: 'https://api.kimi.com/coding',
      apiKey: SECRET,
      api: 'anthropic-messages',
    }, {
      fetchImpl: async () => jsonResponse(401, { error: 'nope' }),
    })
    expect(result).toEqual({ ok: false, error: 'unavailable' })
  })

  test('missing key or url does not call fetch', async () => {
    let called = false
    const result = await fetchCustomEndpointModels({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '   ',
      api: 'openai-completions',
    }, {
      fetchImpl: async () => {
        called = true
        return jsonResponse(200, { data: [] })
      },
    })
    expect(called).toBe(false)
    expect(result).toEqual({ ok: false, error: 'missing_input' })
  })
})

describe('custom model field after an automatic fetch', () => {
  test('uses a picker only when the catalog has models', () => {
    expect(customModelFieldMode('ready', 3)).toBe('picker')
    expect(customModelFieldMode('loading', 3)).toBe('picker')
    expect(customModelFieldMode('loading', 0)).toBe('pending')
    expect(customModelFieldMode('idle', 0)).toBe('pending')
    expect(customModelFieldMode('empty', 0)).toBe('manual')
    expect(customModelFieldMode('error', 4)).toBe('manual')
  })

  test('preselects the fetched list and keeps the first id as the default', () => {
    expect(selectionAfterAutoFetch({
      current: 'claude-opus-4-8, claude-sonnet-4-6',
      fetchedIds: ['kimi-k2', 'moonshot-v1-128k'],
      preserveExisting: false,
    })).toBe('kimi-k2, moonshot-v1-128k')
  })

  test('does not replace models already saved or typed', () => {
    expect(selectionAfterAutoFetch({
      current: 'my-model, gpt-4o',
      fetchedIds: ['kimi-k2', 'gpt-4o'],
      preserveExisting: true,
    })).toBe('my-model, gpt-4o')
  })

  test('blocks save until a fetch finishes or the user types a model', () => {
    expect(customEndpointModelsBlockSave({ hasSelection: false, phase: 'idle' })).toBe('pending')
    expect(customEndpointModelsBlockSave({ hasSelection: false, phase: 'loading' })).toBe('pending')
    expect(customEndpointModelsBlockSave({ hasSelection: false, phase: 'error' })).toBe('missing')
    expect(customEndpointModelsBlockSave({ hasSelection: false, phase: 'empty' })).toBe('missing')
    expect(customEndpointModelsBlockSave({ hasSelection: true, phase: 'loading' })).toBeNull()
    expect(customEndpointModelsBlockSave({ hasSelection: true, phase: 'error' })).toBeNull()
  })
})

describe('mergeFetchedModelSelection', () => {
  test('keeps models the user already entered and appends the rest in catalog order', () => {
    expect(mergeFetchedModelSelection(
      'my-model, gpt-4o',
      ['zeta', 'gpt-4o', 'alpha'],
      true,
    )).toBe('my-model, gpt-4o, zeta, alpha')
  })

  test('matches a saved id case-insensitively so it is not duplicated', () => {
    expect(mergeFetchedModelSelection(
      'GPT-4o，my-model',
      ['gpt-4o', 'alpha'],
      true,
    )).toBe('GPT-4o, my-model, alpha')
  })

  test('replaces an untouched suggestion with the fetched list', () => {
    expect(mergeFetchedModelSelection(
      'claude-opus-4-8, claude-sonnet-4-6',
      ['kimi-k2', 'moonshot-v1'],
      false,
    )).toBe('kimi-k2, moonshot-v1')
  })
})
