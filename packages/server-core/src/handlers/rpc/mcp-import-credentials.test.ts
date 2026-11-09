import { describe, expect, it, mock } from 'bun:test'
import type { McpValidationResult } from '@craft-agent/shared/mcp'
import type { McpImportCandidate } from '@craft-agent/shared/resources'
import type { LoadedSource } from '@craft-agent/shared/sources'
import {
  activateImportedMcpSources,
  extractMcpImportCredentials,
  resumeInterruptedMcpValidations,
  startMcpSourceValidation,
  type McpImportCredentialDependencies,
} from './mcp-import-credentials'

function candidate(
  name: string,
  overrides: Partial<McpImportCandidate> = {},
): McpImportCandidate {
  return {
    key: `${name}:0`,
    name,
    suggestedSlug: name,
    conflict: false,
    mcp: {
      transport: 'http',
      url: `https://example.com/${name}`,
      authType: 'bearer',
    },
    redactions: ['config.mcp.headers.Authorization'],
    needsAuth: true,
    ...overrides,
  }
}

describe('extractMcpImportCredentials', () => {
  it('moves an Authorization Bearer token into the secure credential payload', () => {
    const server = candidate('anysearch')
    const credentials = extractMcpImportCredentials(JSON.stringify({
      mcpServers: {
        anysearch: {
          type: 'http',
          url: 'https://api.anysearch.com/mcp',
          headers: {
            Authorization: 'Bearer token-for-secure-storage',
            'X-Anysearch-Client': 'mcp/1.0.0',
          },
        },
      },
    }), [server])

    expect(credentials.get(server.key)).toBe('token-for-secure-storage')
    expect(server.mcp.headers).toBeUndefined()
  })

  it('preserves custom secret headers as structured secure credentials', () => {
    const server = candidate('custom', {
      mcp: {
        transport: 'http',
        url: 'https://example.com/custom',
        authType: 'bearer',
        headerNames: ['X-API-Key'],
      },
    })
    const credentials = extractMcpImportCredentials(JSON.stringify({
      servers: {
        custom: {
          url: 'https://example.com/custom',
          headers: {
            'X-API-Key': 'custom-secret-value',
            Authorization: 'Bearer secondary-token',
            'X-Client': 'selection',
          },
        },
      },
    }), [server])

    expect(JSON.parse(credentials.get(server.key)!)).toEqual({
      'X-API-Key': 'custom-secret-value',
      Authorization: 'Bearer secondary-token',
    })
  })

  it('does not store unresolved environment-variable placeholders', () => {
    const bearer = candidate('bearer')
    const custom = candidate('custom', {
      key: 'custom:1',
      mcp: {
        transport: 'http',
        url: 'https://example.com/custom',
        authType: 'bearer',
        headerNames: ['X-API-Key'],
      },
    })
    const credentials = extractMcpImportCredentials(JSON.stringify({
      mcpServers: {
        bearer: {
          url: 'https://example.com/bearer',
          headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
        },
        custom: {
          url: 'https://example.com/custom',
          headers: { 'X-API-Key': '$MCP_API_KEY' },
        },
      },
    }), [bearer, custom])

    expect(credentials.size).toBe(0)
  })

  it('supports single-server and array-shaped MCP configurations', () => {
    const single = candidate('single')
    const first = candidate('first')
    const second = candidate('mcp-2', { key: 'mcp-2:1' })

    const singleCredentials = extractMcpImportCredentials(JSON.stringify({
      name: 'single',
      url: 'https://example.com/single',
      headers: { authorization: 'bearer single-token' },
    }), [single])
    const arrayCredentials = extractMcpImportCredentials(JSON.stringify([
      { name: 'first', url: 'https://example.com/first', headers: { Authorization: 'Bearer first-token' } },
      { url: 'https://example.com/second', headers: { Authorization: 'Bearer second-token' } },
    ]), [first, second])

    expect(singleCredentials.get(single.key)).toBe('single-token')
    expect(arrayCredentials.get(first.key)).toBe('first-token')
    expect(arrayCredentials.get(second.key)).toBe('second-token')
  })
})

describe('activateImportedMcpSources', () => {
  function sourceFixture(imported: McpImportCandidate) {
    let current: LoadedSource | null = {
      workspaceId: 'workspace-folder-name',
      config: {
        id: `${imported.suggestedSlug}_source-id`,
        slug: imported.suggestedSlug,
        name: imported.name,
        provider: imported.name,
        type: 'mcp',
        enabled: false,
        isAuthenticated: false,
        connectionStatus: imported.needsAuth ? 'needs_auth' : 'untested',
        mcp: imported.mcp,
      },
    } as LoadedSource

    const saveCredential = mock(async (_source: LoadedSource, _value: string) => {})
    const saveSourceConfig = mock((_workspaceRootPath: string, config: LoadedSource['config']) => {
      if (current) current = { ...current, config }
    })
    const validateConnection = mock(async (_source: LoadedSource) => ({ success: true as const }))
    const notifySourceChanged = mock((_workspaceRootPath: string, _sourceSlug: string) => {})
    const deps: McpImportCredentialDependencies = {
      loadSource: () => current,
      saveCredential,
      saveSourceConfig,
      validateConnection,
      notifySourceChanged,
      now: () => 123_456,
    }

    return {
      deps,
      saveCredential,
      saveSourceConfig,
      validateConnection,
      notifySourceChanged,
      get source() { return current },
      deleteSource() { current = null },
    }
  }

  it('persists the connecting state immediately and marks connected only after real validation', async () => {
    const imported = candidate('anysearch')
    const fixture = sourceFixture(imported)
    let completeValidation: ((result: McpValidationResult) => void) | undefined
    fixture.deps.validateConnection = mock(() => new Promise<McpValidationResult>(resolve => {
      completeValidation = resolve
    }))

    const pending = activateImportedMcpSources(
      '/workspace',
      [imported],
      [{ key: imported.key, action: 'overwrite' }],
      ['anysearch'],
      new Map([[imported.key, 'token-for-secure-storage']]),
      fixture.deps,
    )

    expect(pending).toHaveLength(1)
    expect(fixture.source?.config).toMatchObject({
      enabled: false,
      isAuthenticated: false,
      connectionStatus: 'connecting',
    })
    expect(fixture.notifySourceChanged).toHaveBeenCalledTimes(1)
    expect(fixture.saveCredential).toHaveBeenCalledWith(expect.anything(), 'token-for-secure-storage')

    await Promise.resolve()
    expect(fixture.source?.config.connectionStatus).toBe('connecting')
    completeValidation?.({ success: true })
    await Promise.all(pending)

    expect(fixture.source?.config).toMatchObject({
      enabled: true,
      isAuthenticated: true,
      connectionStatus: 'connected',
      lastTestedAt: 123_456,
    })
    expect(fixture.notifySourceChanged).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(fixture.saveSourceConfig.mock.calls)).not.toContain('token-for-secure-storage')
  })

  it('keeps invalid credentials visible as an actionable authentication failure', async () => {
    const imported = candidate('unauthorized')
    const fixture = sourceFixture(imported)
    fixture.deps.validateConnection = mock(async () => ({
      success: false,
      error: '401 Unauthorized',
      errorType: 'needs-auth' as const,
    }))

    await Promise.all(activateImportedMcpSources(
      '/workspace',
      [imported],
      [{ key: imported.key, action: 'overwrite' }],
      ['unauthorized'],
      new Map([[imported.key, 'invalid-token']]),
      fixture.deps,
    ))

    expect(fixture.source?.config).toMatchObject({
      enabled: false,
      isAuthenticated: false,
      connectionStatus: 'needs_auth',
      connectionError: '401 Unauthorized',
    })
  })

  it('keeps failed network connections disabled and stores the actionable error', async () => {
    const imported = candidate('offline', {
      needsAuth: false,
      mcp: { transport: 'http', url: 'https://example.com/offline', authType: 'none' },
    })
    const fixture = sourceFixture(imported)
    fixture.deps.validateConnection = mock(async () => ({
      success: false,
      error: 'Server is unreachable',
      errorType: 'failed' as const,
    }))

    await Promise.all(activateImportedMcpSources(
      '/workspace',
      [imported],
      [{ key: imported.key, action: 'overwrite' }],
      ['offline'],
      new Map(),
      fixture.deps,
    ))

    expect(fixture.saveCredential).not.toHaveBeenCalled()
    expect(fixture.source?.config).toMatchObject({
      enabled: false,
      isAuthenticated: false,
      connectionStatus: 'failed',
      connectionError: 'Server is unreachable',
    })
  })

  it('keeps skipped and credential-less authenticated sources untouched', () => {
    const skipped = candidate('existing', { conflict: true })
    const missing = candidate('missing', { key: 'missing:1' })
    const fixture = sourceFixture(missing)

    const pending = activateImportedMcpSources(
      '/workspace',
      [skipped, missing],
      [{ key: skipped.key, action: 'skip' }, { key: missing.key, action: 'overwrite' }],
      ['missing'],
      new Map([[skipped.key, 'must-not-save']]),
      fixture.deps,
    )

    expect(pending).toEqual([])
    expect(fixture.saveCredential).not.toHaveBeenCalled()
    expect(fixture.saveSourceConfig).not.toHaveBeenCalled()
  })

  it('reports credential-store failures without enabling the source', async () => {
    const imported = candidate('keychain')
    const fixture = sourceFixture(imported)
    fixture.deps.saveCredential = mock(async () => {
      throw new Error('Secure credential storage is unavailable')
    })

    await Promise.all(activateImportedMcpSources(
      '/workspace',
      [imported],
      [{ key: imported.key, action: 'overwrite' }],
      ['keychain'],
      new Map([[imported.key, 'secret-token']]),
      fixture.deps,
    ))

    expect(fixture.validateConnection).not.toHaveBeenCalled()
    expect(fixture.source?.config).toMatchObject({
      enabled: false,
      connectionStatus: 'failed',
      connectionError: 'Secure credential storage is unavailable',
    })
  })

  it('prevents an older validation attempt from replacing a newer retry result', async () => {
    const imported = candidate('retry', {
      needsAuth: false,
      mcp: { transport: 'http', url: 'https://example.com/retry', authType: 'none' },
    })
    const fixture = sourceFixture(imported)
    const resolvers: Array<(result: McpValidationResult) => void> = []
    fixture.deps.validateConnection = mock(() => new Promise<McpValidationResult>(resolve => {
      resolvers.push(resolve)
    }))

    const firstAttempt = startMcpSourceValidation('/workspace', 'retry', fixture.deps)
    const secondAttempt = startMcpSourceValidation('/workspace', 'retry', fixture.deps)
    resolvers[1]?.({ success: true })
    await secondAttempt
    resolvers[0]?.({ success: false, error: 'stale failure', errorType: 'failed' })
    await firstAttempt

    expect(fixture.source?.config).toMatchObject({
      enabled: true,
      connectionStatus: 'connected',
      connectionError: undefined,
    })
  })

  it('does not recreate a source deleted while validation is in flight', async () => {
    const imported = candidate('deleted', {
      needsAuth: false,
      mcp: { transport: 'http', url: 'https://example.com/deleted', authType: 'none' },
    })
    const fixture = sourceFixture(imported)
    let completeValidation: ((result: McpValidationResult) => void) | undefined
    fixture.deps.validateConnection = mock(() => new Promise<McpValidationResult>(resolve => {
      completeValidation = resolve
    }))

    const pending = startMcpSourceValidation('/workspace', 'deleted', fixture.deps)
    fixture.deleteSource()
    completeValidation?.({ success: true })
    await pending

    expect(fixture.source).toBeNull()
    expect(fixture.saveSourceConfig).toHaveBeenCalledTimes(1)
    expect(fixture.notifySourceChanged).toHaveBeenCalledTimes(1)
  })

  it('resumes a persisted connecting source once after an app restart', async () => {
    const imported = candidate('interrupted', {
      needsAuth: false,
      mcp: { transport: 'http', url: 'https://example.com/interrupted', authType: 'none' },
    })
    const fixture = sourceFixture(imported)
    fixture.source!.config.connectionStatus = 'connecting'
    let completeValidation: ((result: McpValidationResult) => void) | undefined
    fixture.deps.validateConnection = mock(() => new Promise<McpValidationResult>(resolve => {
      completeValidation = resolve
    }))

    const resumed = resumeInterruptedMcpValidations('/workspace', [fixture.source!], fixture.deps)
    const duplicate = resumeInterruptedMcpValidations('/workspace', [fixture.source!], fixture.deps)

    expect(resumed).toHaveLength(1)
    expect(duplicate).toEqual([])
    completeValidation?.({ success: true })
    await Promise.all(resumed)
    expect((fixture.source as LoadedSource | null)?.config.connectionStatus).toBe('connected')
  })
})
