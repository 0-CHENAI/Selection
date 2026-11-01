import { expect, test } from 'bun:test'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-codex-responses'
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import type { Model } from '@earendil-works/pi-ai'
import { installFastServiceTier } from './gpt-oauth-fast'
import { fastServiceTier, gptOAuthServiceTier, supportsGptOAuthFast, supportsPriorityFast } from '../../shared/src/agent/fast-mode'

const model: Model<'openai-codex-responses'> = {
  id: 'gpt-6.1-sol', name: 'GPT', provider: 'openai-codex', api: 'openai-codex-responses',
  baseUrl: 'https://chatgpt.com/backend-api', reasoning: true, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000,
}
const grokModel: Model<'openai-completions'> = {
  id: 'grok-4.7', name: 'Grok', provider: 'xai', api: 'openai-completions',
  baseUrl: 'https://api.x.ai/v1', reasoning: true, input: ['text'],
  cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, contextWindow: 200000, maxTokens: 1000,
}
const token = `x.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture' } })).toString('base64url')}.x`

test('Fast eligibility stays provider and model specific', () => {
  expect(supportsGptOAuthFast('pi/gpt-6.1-sol', 'openai-codex')).toBe(true)
  expect(supportsGptOAuthFast('gpt-6.1-sol', 'openai')).toBe(false)
  expect(supportsGptOAuthFast('gpt-4o', 'openai-codex')).toBe(false)
  expect(supportsGptOAuthFast('grok-4-fast', 'openai-codex')).toBe(false)
  expect(supportsGptOAuthFast('grok-4-fast', 'xai')).toBe(false)
  expect(supportsPriorityFast('pi/grok-4.7', 'xai')).toBe(true)
  expect(supportsPriorityFast('pi/claude-opus-4-7', 'anthropic')).toBe(false)
  expect(fastServiceTier(true, 'pi/grok-4.7', 'xai')).toBe('priority')
  expect(gptOAuthServiceTier(true, 'gpt-4o', 'openai-codex')).toBeUndefined()
  expect(gptOAuthServiceTier(undefined, model.id, model.provider)).toBe('default')
})

test('actual OAuth SDK sends Fast/default without changing model or reasoning, preserving payload hooks', async () => {
  const requests: Record<string, unknown>[] = []
  let enabled = false
  const session = { agent: { streamFunction: streamSimple } } as unknown as AgentSession
  installFastServiceTier(session, () => enabled)
  for (const next of [false, true, false]) {
    enabled = next
    const stream = await session.agent.streamFunction(model, { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }, {
      apiKey: token, reasoning: 'high', transport: 'sse', maxRetries: 0,
      onPayload: async body => ({ ...(body as object), metadata: { fixture: 'preserved' } }),
      fetch: async (_url, init) => {
        const request = new Request(_url, init)
        const bytes = new Uint8Array(await request.arrayBuffer())
        requests.push(JSON.parse(new TextDecoder().decode(request.headers.get('content-encoding') === 'zstd' ? Bun.zstdDecompressSync(bytes) : bytes)))
        return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
      },
    })
    expect((await stream.result()).errorMessage).toBeUndefined()
  }
  expect(requests.map(body => body.service_tier)).toEqual(['default', 'priority', 'default'])
  for (const body of requests) {
    expect(body.model).toBe(model.id)
    expect(body.reasoning).toMatchObject({ effort: 'high' })
    expect(body.metadata).toEqual({ fixture: 'preserved' })
  }
})

test('xAI Grok sends the supported priority service tier', async () => {
  let requestBody: Record<string, unknown> | undefined
  const session = { agent: { streamFunction: streamOpenAiCompletions } } as unknown as AgentSession
  installFastServiceTier(session, () => true)
  const stream = await session.agent.streamFunction(grokModel, { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }, {
    apiKey: 'xai-test', maxRetries: 0,
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body))
      const chunk = {
        id: 'grok-response',
        object: 'chat.completion.chunk',
        created: 1,
        model: grokModel.id,
        service_tier: 'priority',
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }],
      }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  expect((await stream.result()).errorMessage).toBeUndefined()
  expect(requestBody?.service_tier).toBe('priority')
})

test('server rejection is surfaced and never silently retried at Standard speed', async () => {
  let requests = 0
  const session = { agent: { streamFunction: streamSimple } } as unknown as AgentSession
  installFastServiceTier(session, () => true)
  const stream = await session.agent.streamFunction(model, { messages: [] }, {
    apiKey: token, transport: 'sse', maxRetries: 0,
    fetch: async () => { requests++; return new Response(JSON.stringify({ error: { message: 'service_tier priority is not supported for this account' } }), { status: 400 }) },
  })
  const result = await stream.result()
  expect(result.stopReason).toBe('error')
  expect(result.errorMessage).toContain('not supported')
  expect(requests).toBe(1)
})


test('a server downgrade to Standard is reported instead of appearing as active Fast', async () => {
  const session = { agent: { streamFunction: streamSimple } } as unknown as AgentSession
  installFastServiceTier(session, () => true)
  const stream = await session.agent.streamFunction(model, { messages: [] }, {
    apiKey: token, transport: 'sse', maxRetries: 0,
    fetch: async () => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'r', service_tier: 'default', output: [] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }),
  })
  expect((await stream.result()).errorMessage).toContain('Fast 未生效')
})
