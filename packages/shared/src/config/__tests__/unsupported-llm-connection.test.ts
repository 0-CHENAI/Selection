import { describe, expect, it } from 'bun:test'
import {
  isUnsupportedLlmConnection,
  isSessionConnectionUnavailable,
  resolveAuthEnvVars,
  resolveEffectiveConnectionSlug,
  UNSUPPORTED_LLM_CONNECTION_MESSAGE,
  type LlmConnection,
} from '../llm-connections.ts'
import {
  createBackend,
  createBackendFromResolvedContext,
  createConfigFromConnection,
  providerTypeToAgentProvider,
  connectionTypeToProvider,
  testBackendConnection,
} from '../../agent/backend/factory.ts'

function conn(partial: Pick<LlmConnection, 'providerType'> & Partial<LlmConnection>): LlmConnection {
  return {
    slug: partial.slug ?? 'legacy',
    name: partial.name ?? 'Legacy',
    authType: partial.authType ?? 'api_key',
    createdAt: partial.createdAt ?? Date.now(),
    ...partial,
  }
}

describe('isUnsupportedLlmConnection', () => {
  it('marks official Anthropic API Key / OAuth connections unsupported', () => {
    expect(isUnsupportedLlmConnection(conn({ providerType: 'anthropic' }))).toBe(true)
    expect(isUnsupportedLlmConnection(conn({ providerType: 'anthropic', authType: 'oauth' }))).toBe(true)
  })

  it('marks Pi + Anthropic auth unsupported', () => {
    expect(isUnsupportedLlmConnection(conn({
      providerType: 'pi',
      piAuthProvider: 'anthropic',
    }))).toBe(true)
  })

  it('marks anthropic-messages custom endpoints unsupported', () => {
    expect(isUnsupportedLlmConnection(conn({
      providerType: 'pi_compat',
      customEndpoint: { api: 'anthropic-messages' },
    }))).toBe(true)
  })

  it('keeps OpenAI Compatible and other Pi providers supported', () => {
    expect(isUnsupportedLlmConnection(conn({
      providerType: 'pi',
      piAuthProvider: 'openai',
    }))).toBe(false)
    expect(isUnsupportedLlmConnection(conn({
      providerType: 'pi_compat',
      customEndpoint: { api: 'openai-completions' },
    }))).toBe(false)
    expect(isUnsupportedLlmConnection(conn({
      providerType: 'pi',
      piAuthProvider: 'amazon-bedrock',
    }))).toBe(false)
  })
})

describe('isSessionConnectionUnavailable', () => {
  it('treats leftover Anthropic connections as unavailable even when the slug still exists', () => {
    const connections = [
      conn({ slug: 'anthropic-api', providerType: 'anthropic' }),
      conn({ slug: 'pi-anthropic', providerType: 'pi', piAuthProvider: 'anthropic' }),
      conn({
        slug: 'compat-messages',
        providerType: 'pi_compat',
        customEndpoint: { api: 'anthropic-messages' },
      }),
      conn({ slug: 'openai', providerType: 'pi', piAuthProvider: 'openai' }),
    ]

    expect(isSessionConnectionUnavailable('anthropic-api', connections)).toBe(true)
    expect(isSessionConnectionUnavailable('pi-anthropic', connections)).toBe(true)
    expect(isSessionConnectionUnavailable('compat-messages', connections)).toBe(true)
    expect(isSessionConnectionUnavailable('openai', connections)).toBe(false)
    expect(isSessionConnectionUnavailable('deleted', connections)).toBe(true)
  })

  it('marks unlocked sessions unavailable when the fallback is leftover Anthropic', () => {
    const leftover = [
      { ...conn({ slug: 'anthropic-api', providerType: 'anthropic' }), isDefault: true },
    ]
    expect(isSessionConnectionUnavailable(undefined, leftover)).toBe(true)
    expect(isSessionConnectionUnavailable(undefined, leftover, 'anthropic-api')).toBe(true)
  })

  it('skips leftover fallbacks so an unlocked session can use a supported connection', () => {
    const connections = [
      conn({ slug: 'anthropic-api', providerType: 'anthropic' }),
      { ...conn({ slug: 'openai', providerType: 'pi', piAuthProvider: 'openai' }), isDefault: true },
    ]
    expect(resolveEffectiveConnectionSlug(undefined, undefined, connections)).toBe('openai')
    expect(isSessionConnectionUnavailable(undefined, connections)).toBe(false)
    expect(resolveEffectiveConnectionSlug('anthropic-api', undefined, connections)).toBe('anthropic-api')
    expect(isSessionConnectionUnavailable('anthropic-api', connections)).toBe(true)
  })
})

describe('resolveAuthEnvVars', () => {
  it('does not inject Anthropic env vars for leftover connections', async () => {
    const result = await resolveAuthEnvVars(
      conn({ providerType: 'anthropic' }),
      'anthropic-api',
      {
        getLlmApiKey: async () => 'sk-ant-should-not-leak',
        getLlmOAuth: async () => ({ accessToken: 'oauth-should-not-leak' }),
      } as never,
      async () => ({ accessToken: 'oauth-should-not-leak' }),
    )
    expect(result.success).toBe(false)
    expect(result.warning).toBe(UNSUPPORTED_LLM_CONNECTION_MESSAGE)
    expect(result.envVars).toEqual({})
  })
})

describe('factory rejects leftover Anthropic connections', () => {
  it('does not map anthropic providerType onto Pi', () => {
    expect(() => providerTypeToAgentProvider('anthropic')).toThrow(UNSUPPORTED_LLM_CONNECTION_MESSAGE)
    expect(() => connectionTypeToProvider('anthropic')).toThrow(UNSUPPORTED_LLM_CONNECTION_MESSAGE)
  })

  it('refuses to instantiate a backend for leftover Anthropic connections', () => {
    expect(() => createBackend({
      provider: 'anthropic',
      workspace: {
        id: 'ws',
        name: 'WS',
        slug: 'ws',
        rootPath: '/tmp',
        createdAt: Date.now(),
      },
      isHeadless: true,
    } as never)).toThrow(UNSUPPORTED_LLM_CONNECTION_MESSAGE)
  })

  it('refuses createConfigFromConnection for leftover Anthropic connections', () => {
    expect(() => createConfigFromConnection(
      conn({ providerType: 'anthropic' }),
      {
        workspace: {
          id: 'ws',
          name: 'WS',
          slug: 'ws',
          rootPath: '/tmp',
          createdAt: Date.now(),
        },
        isHeadless: true,
      },
    )).toThrow(UNSUPPORTED_LLM_CONNECTION_MESSAGE)
  })

  it('refuses createBackendFromResolvedContext for leftover Anthropic context', () => {
    expect(() => createBackendFromResolvedContext({
      context: {
        connection: conn({ providerType: 'anthropic' }),
        provider: 'anthropic',
        authType: 'api_key',
        resolvedModel: 'claude-sonnet-4-6',
        capabilities: { needsHttpPoolServer: false },
      },
      coreConfig: {
        workspace: {
          id: 'ws',
          name: 'WS',
          slug: 'ws',
          rootPath: '/tmp',
          createdAt: Date.now(),
        },
        isHeadless: true,
      },
      hostRuntime: {
        appRootPath: process.cwd(),
        isPackaged: false,
      },
    })).toThrow(UNSUPPORTED_LLM_CONNECTION_MESSAGE)
  })

  it('refuses testBackendConnection for leftover Pi+Anthropic hints', async () => {
    const result = await testBackendConnection({
      provider: 'pi',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      hostRuntime: {
        appRootPath: process.cwd(),
        isPackaged: false,
      },
      connection: {
        providerType: 'pi',
        piAuthProvider: 'anthropic',
      },
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe(UNSUPPORTED_LLM_CONNECTION_MESSAGE)
  })
})
