import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryCredentialStore, normalizeContext } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { streamSimple as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages'
import { streamSimple as streamGoogle } from '@earendil-works/pi-ai/api/google-generative-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import { collectOutboundImages, imageBlock } from '../../config/__tests__/vision-image-fixtures.ts'

/**
 * Local contract: capture the HTTP body the Pi SDK + interceptor actually send.
 * These are not live provider calls. Official keys are not read from the machine.
 */

type CapturedRequest = { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }

function openaiChatSse(): string {
  return [
    `data: ${JSON.stringify({
      id: 'chatcmpl-vision',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }],
    })}`,
    `data: ${JSON.stringify({
      id: 'chatcmpl-vision',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 1 },
    })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
}

function anthropicSse(): string {
  return [
    'event: message_start',
    `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_vision', type: 'message', role: 'assistant', content: [],
        model: 'claude-sonnet-4-6', stop_reason: null,
        usage: { input_tokens: 8, output_tokens: 1 },
      },
    })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}`,
    '',
    'event: content_block_delta',
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })}`,
    '',
    'event: content_block_stop',
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })}`,
    '',
    'event: message_stop',
    `data: ${JSON.stringify({ type: 'message_stop' })}`,
    '',
  ].join('\n')
}

function googleJson(): string {
  return JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 1 },
  })
}

function stubModel<T extends Api>(input: {
  id: string
  api: T
  provider: string
  baseUrl: string
  modalities?: Array<'text' | 'image'>
}): Model<T> {
  return {
    id: input.id,
    name: input.id,
    api: input.api,
    provider: input.provider,
    baseUrl: input.baseUrl,
    reasoning: false,
    input: input.modalities ?? ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 128,
  } as Model<T>
}

async function capture(input: {
  apiHint: string
  sse?: string
  json?: string
  run: (origin: string) => Promise<unknown>
}): Promise<{ request: CapturedRequest; images: ReturnType<typeof collectOutboundImages> }> {
  const seen: CapturedRequest[] = []
  const previousApi = process.env.CRAFT_PI_MODEL_API
  const sessionDir = mkdtempSync(join(tmpdir(), 'vision-outbound-'))
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const headers: Record<string, string> = {}
      req.headers.forEach((value, key) => { headers[key] = value })
      const text = await req.text()
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(text) as Record<string, unknown> } catch { body = { raw: text } }
      seen.push({ method: req.method, url: req.url, headers, body })
      if (input.json) {
        return new Response(input.json, { headers: { 'content-type': 'application/json' } })
      }
      const sse = input.sse ?? (input.apiHint.includes('anthropic') ? anthropicSse() : openaiChatSse())
      return new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  process.env.CRAFT_PI_MODEL_API = input.apiHint
  process.env.CRAFT_SESSION_DIR = sessionDir
  try {
    await input.run(server.url.origin).catch(() => undefined)
    const request = seen[0]
    if (!request) throw new Error(`no outbound request for ${input.apiHint}`)
    return { request, images: collectOutboundImages(request.body) }
  } finally {
    if (previousApi === undefined) delete process.env.CRAFT_PI_MODEL_API
    else process.env.CRAFT_PI_MODEL_API = previousApi
    delete process.env.CRAFT_SESSION_DIR
    server.stop(true)
    rmSync(sessionDir, { recursive: true, force: true })
  }
}

const userTurn = (text: string, images: Array<{ type: 'image'; data: string; mimeType: string }>) => ({
  role: 'user' as const,
  content: [{ type: 'text' as const, text }, ...images],
  timestamp: Date.now(),
})

describe('provider outbound image payloads', () => {
  afterEach(() => {
    delete process.env.CRAFT_PI_MODEL_API
    delete process.env.CRAFT_PI_MODEL_PROVIDER
  })

  it('rejects stringified OpenAI vision arrays instead of treating them as images', () => {
    expect(() => collectOutboundImages({
      messages: [{
        role: 'user',
        content: JSON.stringify([
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aaaa' } },
          { type: 'text', text: '这张图是什么？' },
        ]),
      }],
    })).toThrow(/stringified/)
  })

  it('sends Kimi K3.1 Pro Chat Completions a JSON array with the attached image hash', async () => {
    const shot = imageBlock('SELECTION_KIMI_K31_PRO_NOT_A_MAP')
    const { request, images } = await capture({
      apiHint: 'openai-completions',
      run: async (origin) => {
        const store = new InMemoryCredentialStore()
        await store.modify('kimi-coding', async () => ({ type: 'api_key', key: 'test-vision-key' }))
        const models = builtinModels({ credentials: store })
        const catalog = models.getModel('kimi-coding', 'k3.1-pro')
        if (!catalog) throw new Error('catalog is missing k3.1-pro')
        process.env.CRAFT_PI_MODEL_PROVIDER = 'kimi-coding'
        return models.stream({ ...catalog, baseUrl: `${origin}/v1` }, {
          systemPrompt: 'You are a vision test assistant.',
          messages: [userTurn('这张图是什么？', [{ type: 'image', data: shot.data, mimeType: shot.mimeType }])],
        }).result()
      },
    })
    expect(new URL(request.url).pathname).toBe('/v1/chat/completions')
    const user = (request.body.messages as Array<{ role?: string; content?: unknown }>)?.find(message => message.role === 'user')
    expect(typeof user?.content).not.toBe('string')
    expect(Array.isArray(user?.content)).toBe(true)
    expect(images).toHaveLength(1)
    expect(images[0]?.protocol).toBe('openai-completions')
    expect(images[0]?.contentIsArray).toBe(true)
    expect(images[0]?.sha256).toBe(shot.sha256)
    expect(images[0]?.bytes.equals(shot.bytes)).toBe(true)
  }, 20_000)

  it('preserves two-image order for Moonshot Kimi K3.1 Pro', async () => {
    const first = imageBlock('MOONSHOT_VISION_A')
    const second = imageBlock('MOONSHOT_VISION_B')
    const { images } = await capture({
      apiHint: 'openai-completions',
      run: async (origin) => {
        const store = new InMemoryCredentialStore()
        await store.modify('moonshotai', async () => ({ type: 'api_key', key: 'test-vision-key' }))
        const models = builtinModels({ credentials: store })
        const catalog = models.getModel('moonshotai', 'kimi-k3.1-pro')
        if (!catalog) throw new Error('catalog is missing moonshotai/kimi-k3.1-pro')
        return models.stream({ ...catalog, baseUrl: `${origin}/v1` }, {
          messages: [userTurn('compare these images', [
            { type: 'image', data: first.data, mimeType: first.mimeType },
            { type: 'image', data: second.data, mimeType: second.mimeType },
          ])],
        }).result()
      },
    })
    expect(images.map(image => image.sha256)).toEqual([first.sha256, second.sha256])
  }, 20_000)

  it('sends the same pixels for Moonshot CN, DeepSeek flash, Anthropic, OpenAI Responses, and Google', async () => {
    const shot = imageBlock('SHARED_VISION_PIXELS')
    const image = { type: 'image' as const, data: shot.data, mimeType: shot.mimeType }

    const moonshotCn = await capture({
      apiHint: 'openai-completions',
      run: async (origin) => {
        const store = new InMemoryCredentialStore()
        await store.modify('moonshotai-cn', async () => ({ type: 'api_key', key: 'test-vision-key' }))
        const models = builtinModels({ credentials: store })
        const catalog = models.getModel('moonshotai-cn', 'kimi-k3.1-pro')
        if (!catalog) throw new Error('catalog is missing moonshotai-cn/kimi-k3.1-pro')
        return models.stream({ ...catalog, baseUrl: `${origin}/v1` }, {
          messages: [userTurn('describe', [image])],
        }).result()
      },
    })
    expect(moonshotCn.images[0]?.sha256).toBe(shot.sha256)

    const flash = await capture({
      apiHint: 'openai-completions',
      run: async (origin) => {
        const store = new InMemoryCredentialStore()
        await store.modify('deepseek', async () => ({ type: 'api_key', key: 'test-vision-key' }))
        const models = builtinModels({ credentials: store })
        const catalog = models.getModel('deepseek', 'deepseek-flash')
        if (!catalog) throw new Error('catalog is missing deepseek-flash')
        return models.stream({ ...catalog, baseUrl: `${origin}/v1` }, {
          messages: [userTurn('describe', [image])],
        }).result()
      },
    })
    expect(flash.images[0]?.sha256).toBe(shot.sha256)

    const claude = await capture({
      apiHint: 'anthropic-messages',
      sse: anthropicSse(),
      run: async (origin) => streamAnthropic(
        stubModel({ id: 'claude-sonnet-4-6', api: 'anthropic-messages', provider: 'anthropic', baseUrl: origin }),
        normalizeContext({ messages: [userTurn('describe', [image])] }),
        { apiKey: 'test-vision-key', maxRetries: 0 },
      ).result(),
    })
    expect(claude.images[0]?.protocol).toBe('anthropic-messages')
    expect(claude.images[0]?.sha256).toBe(shot.sha256)
    expect(new URL(claude.request.url).pathname).toContain('/messages')

    const responses = await capture({
      apiHint: 'openai-responses',
      run: async (origin) => streamOpenAiResponses(
        stubModel({ id: 'gpt-5.4', api: 'openai-responses', provider: 'openai', baseUrl: `${origin}/v1` }),
        normalizeContext({ messages: [userTurn('describe', [image])] }),
        { apiKey: 'test-vision-key', maxRetries: 0 },
      ).result(),
    })
    expect(responses.images[0]?.protocol).toBe('openai-responses')
    expect(responses.images[0]?.sha256).toBe(shot.sha256)

    const google = await capture({
      apiHint: '',
      json: googleJson(),
      run: async (origin) => streamGoogle(
        stubModel({ id: 'gemini-2.5-flash', api: 'google-generative-ai', provider: 'google', baseUrl: origin }),
        normalizeContext({ messages: [userTurn('describe', [image])] }),
        { apiKey: 'test-vision-key', maxRetries: 0 },
      ).result(),
    })
    expect(google.images[0]?.protocol).toBe('google-generative-ai')
    expect(google.images[0]?.sha256).toBe(shot.sha256)
  }, 60_000)

  it('keeps the image hash when NORM and PRO tool lists are advertised', async () => {
    const shot = imageBlock('PRO_NORM_SAME_PIXELS')
    const image = { type: 'image' as const, data: shot.data, mimeType: shot.mimeType }
    const tools = {
      NORM: [{ name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
      PRO: [
        { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
        { name: 'mcp__session__office_business', description: 'Office business', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
      ],
    }

    for (const mode of ['NORM', 'PRO'] as const) {
      const { images } = await capture({
        apiHint: 'openai-completions',
        run: async (origin) => streamOpenAiCompletions(
          stubModel({ id: 'k3.1-pro', api: 'openai-completions', provider: 'kimi-coding', baseUrl: `${origin}/v1` }),
          normalizeContext({
            messages: [userTurn('这张图是什么？', [image])],
            tools: tools[mode],
          }),
          { apiKey: 'test-vision-key', maxRetries: 0 },
        ).result(),
      })
      expect(images[0]?.sha256).toBe(shot.sha256)
      expect(images[0]?.contentIsArray).toBe(true)
    }
  }, 40_000)

  it('does not put image bytes on the wire for catalog text-only DeepSeek v4 Pro', async () => {
    const shot = imageBlock('TEXT_ONLY_MUST_NOT_LEAK')
    const { images, request } = await capture({
      apiHint: 'openai-completions',
      run: async (origin) => {
        const store = new InMemoryCredentialStore()
        await store.modify('deepseek', async () => ({ type: 'api_key', key: 'test-vision-key' }))
        const models = builtinModels({ credentials: store })
        const catalog = models.getModel('deepseek', 'deepseek-v4-pro')
        if (!catalog) throw new Error('catalog is missing deepseek-v4-pro')
        return models.stream({ ...catalog, baseUrl: `${origin}/v1` }, {
          messages: [userTurn('这张图是什么？', [{ type: 'image', data: shot.data, mimeType: shot.mimeType }])],
        }).result()
      },
    })
    expect(images).toEqual([])
    expect(JSON.stringify(request.body)).not.toContain(shot.data)
  }, 20_000)

  it('sends a custom openai-completions endpoint the original hash', async () => {
    const shot = imageBlock('CUSTOM_ENDPOINT_VISION')
    const { images } = await capture({
      apiHint: 'openai-completions',
      run: async (origin) => streamOpenAiCompletions(
        stubModel({ id: 'Maylo', api: 'openai-completions', provider: 'openai', baseUrl: `${origin}/v1` }),
        normalizeContext({ messages: [userTurn('这张图是什么？', [{ type: 'image', data: shot.data, mimeType: shot.mimeType }])] }),
        { apiKey: 'test-vision-key', maxRetries: 0 },
      ).result(),
    })
    expect(images[0]?.sha256).toBe(shot.sha256)
    expect(images[0]?.contentIsArray).toBe(true)
  }, 20_000)
})
