import { expect, test } from 'bun:test'
import { fastConnectionFamily, fastTransportFamily } from './fast-mode'
import type { LlmConnection } from '../config/llm-connections'

const chatgpt: LlmConnection = { slug: 'test', createdAt: 1, name: '任意名称', providerType: 'pi', piAuthProvider: 'openai-codex', authType: 'oauth' }
const grok: LlmConnection = { ...chatgpt, piAuthProvider: 'xai', authType: 'api_key' }

test('Fast follows connection auth and protocol rather than provider labels alone', () => {
  expect(fastConnectionFamily('pi/gpt-6-luna', chatgpt)).toBe('chatgpt')
  expect(fastConnectionFamily('pi/grok-4.7', grok)).toBe('grok')
  expect(fastConnectionFamily('pi/gpt-6-luna', { ...chatgpt, authType: 'api_key' })).toBeUndefined()
  expect(fastConnectionFamily('pi/gpt-6-luna', { ...chatgpt, customEndpoint: { api: 'openai-completions' } })).toBeUndefined()
  expect(fastConnectionFamily('pi/gpt-6-luna', { ...chatgpt, baseUrl: 'https://gateway.example/v1' })).toBeUndefined()
  expect(fastConnectionFamily('pi/grok-4.7', { ...grok, customEndpoint: { api: 'anthropic-messages' } })).toBeUndefined()
  expect(fastConnectionFamily('pi/grok-4.7', { ...grok, baseUrl: 'https://gateway.example/v1' })).toBeUndefined()
  expect(fastConnectionFamily('pi/gpt-6-luna', { ...chatgpt, providerType: 'anthropic' })).toBeUndefined()
  expect(fastConnectionFamily('pi/claude-opus-4-7', chatgpt)).toBeUndefined()
  expect(fastConnectionFamily('pi/gpt-6-luna', undefined)).toBeUndefined()
})

test('runtime Fast eligibility rejects a mismatched wire format or endpoint', () => {
  expect(fastTransportFamily('gpt-6-luna', 'openai-codex', 'openai-codex-responses', 'https://chatgpt.com/backend-api/codex/')).toBe('chatgpt')
  expect(fastTransportFamily('grok-4.7', 'xai', 'openai-completions', 'https://api.x.ai/v1')).toBe('grok')
  expect(fastTransportFamily('grok-4.7', 'xai', 'anthropic-messages', 'https://api.x.ai/v1')).toBeUndefined()
  expect(fastTransportFamily('gpt-6-luna', 'openai-codex', 'openai-responses', 'https://chatgpt.com/backend-api')).toBeUndefined()
  for (const url of ['http://api.x.ai/v1', 'https://api.x.ai.evil.test/v1', 'https://api.x.ai/other', 'invalid']) {
    expect(fastTransportFamily('grok-4.7', 'xai', 'openai-completions', url)).toBeUndefined()
  }
})
