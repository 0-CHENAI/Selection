import { describe, expect, it } from 'bun:test'
import {
  fetchGoogleAiStudioCatalog,
  googleCatalogToModelDefinitions,
  isGoogleChatModelId,
  parseGoogleModelsPayload,
  sortGoogleCatalogModels,
  testGoogleAiStudioAccess,
} from '../google-catalog.ts'
import { fallbackThinkingCapability } from '../../agent/thinking-capabilities.ts'

describe('isGoogleChatModelId', () => {
  it('accepts active Gemini 3/4 and Gemma 4 chat models', () => {
    expect(isGoogleChatModelId('gemini-4-neon')).toBe(true)
    expect(isGoogleChatModelId('gemini-4-carbon')).toBe(true)
    expect(isGoogleChatModelId('gemini-4-argon')).toBe(true)
    expect(isGoogleChatModelId('gemini-4-hydrogen')).toBe(true)
    expect(isGoogleChatModelId('gemini-3.8-flash')).toBe(true)
    expect(isGoogleChatModelId('gemini-flash-latest')).toBe(true)
    expect(isGoogleChatModelId('gemma-4-31b-it')).toBe(true)
  })

  it('excludes retired 1.x/2.0 and non-chat specialized endpoints', () => {
    expect(isGoogleChatModelId('gemini-1.5-flash')).toBe(false)
    expect(isGoogleChatModelId('gemini-2.0-flash')).toBe(false)
    expect(isGoogleChatModelId('gemini-pro')).toBe(false)
    expect(isGoogleChatModelId('gemini-embedding-001')).toBe(false)
    expect(isGoogleChatModelId('text-embedding-004')).toBe(false)
    expect(isGoogleChatModelId('imagen-3.0-generate-002')).toBe(false)
    expect(isGoogleChatModelId('veo-3.0-generate-preview')).toBe(false)
    expect(isGoogleChatModelId('gemini-3.1-flash-image')).toBe(false)
    expect(isGoogleChatModelId('gemini-2.5-flash-preview-tts')).toBe(false)
    expect(isGoogleChatModelId('gemini-live-3.8-flash')).toBe(false)
    expect(isGoogleChatModelId('gemini-2.5-flash-native-audio-dialog')).toBe(false)
    expect(isGoogleChatModelId('gemini-3.5-transcribe')).toBe(false)
    expect(isGoogleChatModelId('gemini-decision-1')).toBe(false)
  })
})

describe('parseGoogleModelsPayload and sorting', () => {
  it('parses Google v1beta/models payload, filters non-generateContent, and prioritizes Gemini 4 & 3.8', () => {
    const parsed = parseGoogleModelsPayload({
      models: [
        {
          name: 'models/gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          inputTokenLimit: 1_048_576,
          outputTokenLimit: 65_536,
          supportedGenerationMethods: ['generateContent', 'countTokens'],
          thinking: true,
        },
        {
          name: 'models/gemini-4-neon',
          displayName: 'Gemini 4 Neon',
          description: 'Balanced Gemini 4 frontier reasoning model',
          inputTokenLimit: 1_048_576,
          outputTokenLimit: 65_536,
          supportedGenerationMethods: ['generateContent', 'countTokens'],
          thinking: true,
        },
        {
          name: 'models/gemini-3.8-flash',
          displayName: 'Gemini 3.8 Flash',
          inputTokenLimit: 1_048_576,
          outputTokenLimit: 65_536,
          supportedGenerationMethods: ['generateContent'],
          thinking: true,
        },
        {
          name: 'models/text-embedding-004',
          displayName: 'Embedding',
          supportedGenerationMethods: ['embedContent'],
        },
        {
          name: 'models/gemini-4-future-embed',
          displayName: 'No GenerateContent',
          supportedGenerationMethods: ['countTokens'],
        },
      ],
      nextPageToken: 'page-2',
    })

    expect(parsed.nextPageToken).toBe('page-2')
    const sorted = sortGoogleCatalogModels(parsed.models)
    expect(sorted.map((m) => m.id)).toEqual([
      'gemini-4-neon',
      'gemini-3.8-flash',
      'gemini-2.5-flash',
    ])

    const defs = googleCatalogToModelDefinitions(sorted)
    expect(defs[0]).toMatchObject({
      id: 'pi/gemini-4-neon',
      name: 'Gemini 4 Neon',
      shortName: 'Gemini 4 Neon',
      provider: 'pi',
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      supportsThinking: true,
      supportedThinkingLevels: ['low', 'medium', 'high'],
    })
  })

  it('infers Gemini 4 thinking levels as low/medium/high in fallbackThinkingCapability', () => {
    expect(fallbackThinkingCapability('gemini-4-neon')?.levels).toEqual(['low', 'medium', 'high'])
    expect(fallbackThinkingCapability('gemini-4-carbon')?.levels).toEqual(['low', 'medium', 'high'])
    expect(fallbackThinkingCapability('gemini-4-hydrogen')?.levels).toEqual(['low', 'medium', 'high'])
  })

  it('respects explicit thinking: false from Google API instead of falling back to thinking-enabled', () => {
    const defs = googleCatalogToModelDefinitions([{
      id: 'gemini-4-non-thinking',
      name: 'Gemini 4 Non Thinking',
      description: 'Non-thinking test model',
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      reasoning: false,
    }])

    expect(defs[0]).toMatchObject({
      id: 'pi/gemini-4-non-thinking',
      supportsThinking: false,
      supportedThinkingLevels: [],
      thinkingMode: 'unsupported',
    })
  })
})

describe('fetchGoogleAiStudioCatalog', () => {
  it('sends x-goog-api-key header (never query param) and follows pagination', async () => {
    const requests: Array<{ url: string; headers?: Record<string, string> }> = []
    const fetchImpl = async (input: string, init?: { headers?: Record<string, string> }) => {
      requests.push({ url: input, headers: init?.headers })
      if (!input.includes('pageToken=')) {
        return new Response(JSON.stringify({
          models: [{
            name: 'models/gemini-3.8-flash',
            displayName: 'Gemini 3.8 Flash',
            inputTokenLimit: 1_048_576,
            outputTokenLimit: 65_536,
            supportedGenerationMethods: ['generateContent'],
            thinking: true,
          }],
          nextPageToken: 'tok-2',
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        models: [{
          name: 'models/gemini-4-carbon',
          displayName: 'Gemini 4 Carbon',
          inputTokenLimit: 1_048_576,
          outputTokenLimit: 65_536,
          supportedGenerationMethods: ['generateContent'],
          thinking: true,
        }],
      }), { status: 200 })
    }

    const models = await fetchGoogleAiStudioCatalog({
      apiKey: 'AIza-secret-key',
      fetchImpl,
    })

    expect(requests).toHaveLength(2)
    expect(requests[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
    expect(requests[0]!.url).not.toContain('AIza')
    expect(requests[0]!.headers?.['x-goog-api-key']).toBe('AIza-secret-key')
    expect(requests[1]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=tok-2')
    expect(models.map((m) => m.id)).toEqual(['gemini-4-carbon', 'gemini-3.8-flash'])
  })
})

describe('testGoogleAiStudioAccess', () => {
  it('returns success on 200 without testing a hardcoded model', async () => {
    let seenUrl = ''
    let seenKey = ''
    const result = await testGoogleAiStudioAccess(
      'AIza-valid',
      undefined,
      5_000,
      async (input, init) => {
        seenUrl = input
        seenKey = init?.headers?.['x-goog-api-key'] ?? ''
        return new Response(JSON.stringify({ models: [] }), { status: 200 })
      },
    )

    expect(result).toEqual({ success: true })
    expect(seenUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1')
    expect(seenKey).toBe('AIza-valid')
  })

  it('maps Google 400 API_KEY_INVALID to Invalid API key', async () => {
    const result = await testGoogleAiStudioAccess(
      'AIza-bad',
      undefined,
      5_000,
      async () => new Response(JSON.stringify({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      }), { status: 400 }),
    )

    expect(result).toEqual({ success: false, error: 'Invalid API key' })
  })

  it('maps Google 400 API_KEY_EXPIRED to a clear expiration message', async () => {
    const result = await testGoogleAiStudioAccess(
      'AIza-expired',
      undefined,
      5_000,
      async () => new Response(JSON.stringify({
        error: {
          code: 400,
          message: 'API key expired. Please renew the API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_EXPIRED' }],
        },
      }), { status: 400 }),
    )

    expect(result).toEqual({
      success: false,
      error: 'API key has expired. Create a new key in Google AI Studio.',
    })
  })
})
