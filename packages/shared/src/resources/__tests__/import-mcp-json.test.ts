import { describe, expect, it } from 'bun:test'
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
