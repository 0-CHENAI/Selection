import { describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { importMcpCandidates, parseMcpImportJson } from '../import-mcp-json.ts'
import { loadWorkspaceSources } from '../../sources/storage.ts'

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'mcp-import-'))
}

describe('parseMcpImportJson (#82)', () => {
  it('imports mcpServers maps, single servers, and arrays', () => {
    const root = workspace()
    try {
      const mapped = parseMcpImportJson(JSON.stringify({
        mcpServers: {
          filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
          remote: { url: 'https://example.com/mcp', transport: 'http' },
        },
      }), root)
      expect(mapped.map(item => item.name).sort()).toEqual(['filesystem', 'remote'])
      expect(mapped.find(item => item.name === 'filesystem')?.mcp.transport).toBe('stdio')
      expect(mapped.find(item => item.name === 'remote')?.mcp.url).toBe('https://example.com/mcp')

      const single = parseMcpImportJson(JSON.stringify({ command: 'uvx', args: ['mcp'] }), root)
      expect(single).toHaveLength(1)
      expect(single[0]?.mcp.command).toBe('uvx')

      const list = parseMcpImportJson(JSON.stringify([
        { name: 'one', command: 'a' },
        { name: 'two', url: 'https://example.com/sse', type: 'sse' },
      ]), root)
      expect(list.map(item => item.mcp.transport)).toEqual(['stdio', 'sse'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('strips env secrets and marks the source as needing auth', () => {
    const root = workspace()
    try {
      const [item] = parseMcpImportJson(JSON.stringify({
        command: 'npx',
        env: { API_KEY: 'sk-live-supersecretvalue' },
      }), root)
      expect(item?.mcp.env).toBeUndefined()
      expect(item?.needsAuth).toBe(true)
      expect(item?.redactions.some(path => path.includes('env'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('imports authenticated HTTP MCP configs without persisting bearer secrets', async () => {
    const root = workspace()
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    try {
      const [candidate] = parseMcpImportJson(JSON.stringify({
        mcpServers: {
          anysearch: {
            type: 'http',
            url: 'https://api.anysearch.com/mcp',
            headers: {
              Authorization: 'Bearer as_sk_live_supersecretvalue',
              'X-Anysearch-Client': 'mcp/1.0.0',
            },
          },
        },
      }), root)

      expect(candidate?.mcp).toEqual({
        transport: 'http',
        url: 'https://api.anysearch.com/mcp',
        authType: 'bearer',
        headers: { 'X-Anysearch-Client': 'mcp/1.0.0' },
      })
      expect(candidate?.needsAuth).toBe(true)
      expect(candidate?.redactions).toContain('config.mcp.headers.Authorization')

      await importMcpCandidates(root, [candidate!], [{ key: candidate!.key, action: 'overwrite' }])
      const imported = loadWorkspaceSources(root).find(source => source.config.slug === 'anysearch')
      expect(imported?.config.mcp).toEqual(candidate?.mcp)
      expect(imported?.config.enabled).toBe(false)
      expect(imported?.config.connectionStatus).toBe('needs_auth')
    } finally {
      fetch.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('defaults public HTTP MCP configs to authType none and enables them', async () => {
    const root = workspace()
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    try {
      const [candidate] = parseMcpImportJson(JSON.stringify({
        mcpServers: {
          public: { type: 'streamable-http', url: 'https://example.com/mcp' },
        },
      }), root)

      expect(candidate?.mcp).toEqual({
        transport: 'http',
        url: 'https://example.com/mcp',
        authType: 'none',
      })
      expect(candidate?.needsAuth).toBe(false)

      await importMcpCandidates(root, [candidate!], [{ key: candidate!.key, action: 'overwrite' }])
      const imported = loadWorkspaceSources(root).find(source => source.config.slug === 'public')
      expect(imported?.config.enabled).toBe(true)
      expect(imported?.config.mcp?.authType).toBe('none')
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves explicit OAuth and custom-header credential metadata', () => {
    const root = workspace()
    try {
      const candidates = parseMcpImportJson(JSON.stringify({
        mcpServers: {
          oauth: {
            url: 'https://example.com/oauth-mcp',
            authType: 'oauth',
            clientId: 'client-id',
          },
          custom: {
            url: 'https://example.com/custom-mcp',
            headers: { 'X-API-Key': '${MCP_API_KEY}', 'X-Client': 'selection' },
          },
        },
      }), root)

      expect(candidates[0]?.mcp.authType).toBe('oauth')
      expect(candidates[0]?.mcp.clientId).toBe('client-id')
      expect(candidates[0]?.needsAuth).toBe(true)
      expect(candidates[1]?.mcp).toEqual({
        transport: 'http',
        url: 'https://example.com/custom-mcp',
        authType: 'bearer',
        headers: { 'X-Client': 'selection' },
        headerNames: ['X-API-Key'],
      })
      expect(candidates[1]?.needsAuth).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('sanitizes candidate payloads again at the import boundary', async () => {
    const root = workspace()
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    try {
      const [candidate] = parseMcpImportJson(JSON.stringify({
        mcpServers: { public: { url: 'https://example.com/mcp' } },
      }), root)
      candidate!.mcp.headers = { Authorization: 'Bearer injected-secret-value' }

      await importMcpCandidates(root, [candidate!], [{ key: candidate!.key, action: 'overwrite' }])
      const imported = loadWorkspaceSources(root).find(source => source.config.slug === 'public')
      expect(imported?.config.mcp?.headers).toBeUndefined()
      expect(imported?.config.enabled).toBe(false)
      expect(imported?.config.connectionStatus).toBe('needs_auth')
    } finally {
      fetch.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts VS Code, OpenCode, Windsurf, and streamable HTTP config variants', () => {
    const root = workspace()
    try {
      const vscode = parseMcpImportJson(JSON.stringify({
        servers: { vscode: { type: 'http', url: 'https://example.com/vscode' } },
      }), root)
      const opencode = parseMcpImportJson(JSON.stringify({
        mcp: { opencode: { type: 'remote', url: 'https://example.com/opencode' } },
      }), root)
      const windsurf = parseMcpImportJson(JSON.stringify({
        mcpServers: { windsurf: { serverUrl: 'https://example.com/windsurf' } },
      }), root)
      const cline = parseMcpImportJson(JSON.stringify({
        mcpServers: { cline: { type: 'streamableHttp', url: 'https://example.com/cline' } },
      }), root)

      expect(vscode[0]?.mcp.authType).toBe('none')
      expect(opencode[0]?.mcp.transport).toBe('http')
      expect(windsurf[0]?.mcp.url).toBe('https://example.com/windsurf')
      expect(cline[0]?.mcp.transport).toBe('http')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('infers bearer authentication from case-insensitive and contradictory auth headers', () => {
    const root = workspace()
    try {
      const [candidate] = parseMcpImportJson(JSON.stringify({
        mcpServers: {
          remote: {
            url: 'https://example.com/mcp',
            authType: 'none',
            headers: { authorization: 'bearer ${MCP_TOKEN}' },
          },
        },
      }), root)

      expect(candidate?.mcp.authType).toBe('bearer')
      expect(candidate?.mcp.headers).toBeUndefined()
      expect(candidate?.mcp.headerNames).toBeUndefined()
      expect(candidate?.needsAuth).toBe(true)
      expect(candidate?.redactions).toContain('config.mcp.headers.authorization')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid JSON, empty files, and unknown schemas', () => {
    const root = workspace()
    try {
      expect(() => parseMcpImportJson('', root)).toThrow(/empty/i)
      expect(() => parseMcpImportJson('{', root)).toThrow(/valid JSON/i)
      expect(() => parseMcpImportJson(JSON.stringify({ foo: 1 }), root)).toThrow(/No MCP servers/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips conflicting sources by default and can overwrite', async () => {
    const root = workspace()
    try {
      const json = JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs'] } } })
      const first = parseMcpImportJson(json, root)
      await importMcpCandidates(root, first, first.map(item => ({ key: item.key, action: 'overwrite' })))
      expect(loadWorkspaceSources(root).some(source => source.config.slug === 'docs')).toBe(true)

      const second = parseMcpImportJson(json, root)
      expect(second[0]?.conflict).toBe(true)
      const skipped = await importMcpCandidates(root, second, second.map(item => ({ key: item.key, action: 'skip' })))
      expect(skipped.skipped).toEqual(['docs'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
