import { describe, expect, it, beforeEach } from 'bun:test'
import { McpClientPool } from '../mcp-pool.ts'
import type { SdkMcpServerConfig } from '../../agent/backend/types.ts'
import type { PoolClient } from '../client.ts'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  LIST_MCP_RESOURCES_TOOL,
  NO_RESOURCE_CAPABILITIES,
  READ_MCP_RESOURCE_TOOL,
  type McpResourceCapabilities,
} from '../resources.ts'

const mockTools: Tool[] = [
  { name: 'test-tool', description: 'A test tool', inputSchema: { type: 'object' as const, properties: {} } },
]

function makeClient(caps: McpResourceCapabilities, options?: {
  resources?: Array<{ uri: string; name?: string }>
  templates?: Array<{ uriTemplate: string; name?: string }>
  contents?: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>
  onList?: () => void
  onRead?: () => void
}): PoolClient {
  return {
    listTools: async () => mockTools,
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    close: async () => {},
    getResourceCapabilities: () => caps,
    listResources: async () => {
      options?.onList?.()
      return { resources: options?.resources ?? [] }
    },
    listResourceTemplates: async () => ({ resourceTemplates: options?.templates ?? [] }),
    readResource: async () => {
      options?.onRead?.()
      return { contents: options?.contents ?? [] }
    },
    subscribeResource: async () => {},
    unsubscribeResource: async () => {},
  }
}

function httpConfig(): SdkMcpServerConfig {
  return { type: 'http', url: 'https://mcp.example.com' }
}

class TestablePool extends McpClientPool {
  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    await this.registerClient(slug, makeClient({ ...NO_RESOURCE_CAPABILITIES }))
    this.activeConfigs.set(slug, config)
  }

  async addClient(slug: string, client: PoolClient): Promise<void> {
    await this.registerClient(slug, client)
  }
}

describe('McpClientPool resource tools', () => {
  let pool: TestablePool

  beforeEach(() => {
    pool = new TestablePool()
  })

  it('omits the client-side tools when no connected server declared resources', async () => {
    await pool.connect('linear', httpConfig())
    const names = pool.getProxyToolDefs().map(def => def.name)
    expect(names).not.toContain(LIST_MCP_RESOURCES_TOOL)
    expect(names).not.toContain(READ_MCP_RESOURCE_TOOL)
    expect(pool.isProxyTool(LIST_MCP_RESOURCES_TOOL)).toBe(true)
    const listed = await pool.callTool(LIST_MCP_RESOURCES_TOOL, {})
    expect(listed.isError).toBe(false)
    expect(listed.content).toContain('No connected MCP servers declare the resources capability')
  })

  it('advertises the tools only for resource-capable servers and lists/reads through them', async () => {
    let listedIncapable = false
    await pool.addClient('linear', makeClient({ ...NO_RESOURCE_CAPABILITIES }, {
      onList: () => { listedIncapable = true },
    }))
    await pool.addClient('docs', makeClient(
      { resources: true, subscribe: false, listChanged: false },
      {
        resources: [{ uri: 'docs://readme', name: 'Readme' }],
        templates: [{ uriTemplate: 'docs://page/{id}', name: 'Page' }],
        contents: [{ uri: 'docs://readme', mimeType: 'text/plain', text: 'hello docs' }],
      },
    ))

    const names = pool.getProxyToolDefs().map(def => def.name)
    expect(names).toContain(LIST_MCP_RESOURCES_TOOL)
    expect(names).toContain(READ_MCP_RESOURCE_TOOL)

    const listed = await pool.callTool(LIST_MCP_RESOURCES_TOOL, {})
    expect(listedIncapable).toBe(false)
    const payload = JSON.parse(listed.content as string) as {
      resources: Array<{ server: string; uri: string; name?: string }>
      templates: Array<{ uriTemplate: string }>
    }
    expect(payload.resources).toEqual([{ server: 'docs', uri: 'docs://readme', name: 'Readme' }])
    expect(payload.templates[0]?.uriTemplate).toBe('docs://page/{id}')

    const filtered = await pool.callTool(LIST_MCP_RESOURCES_TOOL, { server: 'linear' })
    expect(filtered.content).toContain('does not declare the resources capability')

    const read = await pool.callTool(READ_MCP_RESOURCE_TOOL, { server: 'docs', uri: 'docs://readme' })
    expect(read.isError).toBe(false)
    expect(read.content).toContain('hello docs')

    const skipped = await pool.callTool(READ_MCP_RESOURCE_TOOL, { server: 'linear', uri: 'docs://readme' })
    expect(skipped.content).toContain('does not declare the resources capability')
  })
})
