import { describe, expect, it } from 'bun:test'
import {
  LIST_MCP_RESOURCES_TOOL,
  MCP_RESOURCE_LIST_PAGE,
  NO_RESOURCE_CAPABILITIES,
  READ_MCP_RESOURCE_TOOL,
  decodeResourceListCursor,
  encodeResourceListCursor,
  executeListMcpResources,
  executeReadMcpResource,
  formatReadResourceResult,
  getMcpResourceToolDefs,
  isMcpResourceTool,
  resourceCapabilitiesFromServer,
  type ResourceHost,
} from '../resources.ts'

function host(overrides: Partial<ResourceHost> & Pick<ResourceHost, 'getResourceCapableSlugs' | 'getResourceCapabilities'>): ResourceHost {
  return {
    listResources: async () => ({ resources: [] }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    readResource: async () => ({ contents: [] }),
    ...overrides,
  }
}

describe('MCP resource capability helpers', () => {
  it('treats missing resources as unsupported, including subscribe and listChanged', () => {
    expect(resourceCapabilitiesFromServer(undefined)).toEqual(NO_RESOURCE_CAPABILITIES)
    expect(resourceCapabilitiesFromServer({})).toEqual(NO_RESOURCE_CAPABILITIES)
    expect(resourceCapabilitiesFromServer({ resources: {} })).toEqual({
      resources: true,
      subscribe: false,
      listChanged: false,
    })
    expect(resourceCapabilitiesFromServer({ resources: { subscribe: true, listChanged: true } })).toEqual({
      resources: true,
      subscribe: true,
      listChanged: true,
    })
  })

  it('round-trips list cursors', () => {
    const cursor = { slugs: ['docs', 'git'], index: 1, phase: 'templates' as const, cursor: 'abc' }
    expect(decodeResourceListCursor(encodeResourceListCursor(cursor))).toEqual(cursor)
    expect(decodeResourceListCursor('not-valid')).toBeNull()
  })

  it('names the two client-side tools', () => {
    expect(isMcpResourceTool(LIST_MCP_RESOURCES_TOOL)).toBe(true)
    expect(isMcpResourceTool(READ_MCP_RESOURCE_TOOL)).toBe(true)
    expect(isMcpResourceTool('mcp__linear__list_issues')).toBe(false)
    const defs = getMcpResourceToolDefs()
    expect(defs.map(def => def.name)).toEqual([LIST_MCP_RESOURCES_TOOL, READ_MCP_RESOURCE_TOOL])
    expect(defs[0]!.description).toContain('URI')
    expect(defs[1]!.description).toContain('templates')
  })
})

describe('list_mcp_resources', () => {
  it('does not call list/read on servers that did not declare resources', async () => {
    let listed = false
    const result = await executeListMcpResources(host({
      getResourceCapableSlugs: () => [],
      getResourceCapabilities: () => ({ ...NO_RESOURCE_CAPABILITIES }),
      listResources: async () => {
        listed = true
        throw new Error('should not list')
      },
    }), {})
    expect(listed).toBe(false)
    expect(result.isError).toBe(false)
    expect(result.content).toContain('No connected MCP servers declare the resources capability')
  })

  it('filters an unknown or incapable server without calling resources/*', async () => {
    let listed = false
    const result = await executeListMcpResources(host({
      getResourceCapableSlugs: () => ['docs'],
      getResourceCapabilities: (slug) => slug === 'docs'
        ? { resources: true, subscribe: false, listChanged: false }
        : { ...NO_RESOURCE_CAPABILITIES },
      listResources: async () => {
        listed = true
        return { resources: [] }
      },
    }), { server: 'linear' })
    expect(listed).toBe(false)
    expect(result.content).toContain('linear')
    expect(result.content).toContain('does not declare the resources capability')
  })

  it('merges resources/list and templates/list, following server cursors', async () => {
    const calls: Array<{ slug: string; kind: string; cursor?: string }> = []
    const result = await executeListMcpResources(host({
      getResourceCapableSlugs: () => ['docs'],
      getResourceCapabilities: () => ({ resources: true, subscribe: false, listChanged: false }),
      listResources: async (slug, cursor) => {
        calls.push({ slug, kind: 'resources', cursor })
        if (!cursor) return { resources: [{ uri: 'docs://a', name: 'A' }], nextCursor: 'r2' }
        return { resources: [{ uri: 'docs://b', name: 'B' }] }
      },
      listResourceTemplates: async (slug, cursor) => {
        calls.push({ slug, kind: 'templates', cursor })
        return { resourceTemplates: [{ uriTemplate: 'docs://item/{id}', name: 'Item' }] }
      },
    }), {})

    expect(calls).toEqual([
      { slug: 'docs', kind: 'resources', cursor: undefined },
      { slug: 'docs', kind: 'resources', cursor: 'r2' },
      { slug: 'docs', kind: 'templates', cursor: undefined },
    ])
    const parsed = JSON.parse(result.content as string) as {
      resources: Array<{ server: string; uri: string }>
      templates: Array<{ uriTemplate: string }>
      nextCursor?: string
      note?: string
    }
    expect(parsed.resources.map(item => item.uri)).toEqual(['docs://a', 'docs://b'])
    expect(parsed.templates[0]?.uriTemplate).toBe('docs://item/{id}')
    expect(parsed.note).toContain('Fill the URI')
    expect(parsed.nextCursor).toBeUndefined()
  })

  it('stops assembling a page at the list cap and leaves a cursor', async () => {
    const page = Array.from({ length: MCP_RESOURCE_LIST_PAGE }, (_, i) => ({ uri: `docs://${i}` }))
    const result = await executeListMcpResources(host({
      getResourceCapableSlugs: () => ['docs', 'git'],
      getResourceCapabilities: () => ({ resources: true, subscribe: false, listChanged: false }),
      listResources: async (slug) => slug === 'docs'
        ? { resources: page, nextCursor: 'more' }
        : { resources: [{ uri: 'git://x' }] },
      listResourceTemplates: async () => ({ resourceTemplates: [] }),
    }), {})
    const parsed = JSON.parse(result.content as string) as { resources: unknown[]; nextCursor?: string }
    expect(parsed.resources).toHaveLength(MCP_RESOURCE_LIST_PAGE)
    expect(parsed.nextCursor).toBeDefined()
  })
})

describe('read_mcp_resource', () => {
  it('does not read when the server lacks the capability', async () => {
    let read = false
    const result = await executeReadMcpResource(host({
      getResourceCapableSlugs: () => [],
      getResourceCapabilities: () => ({ ...NO_RESOURCE_CAPABILITIES }),
      readResource: async () => {
        read = true
        throw new Error('should not read')
      },
    }), { server: 'docs', uri: 'docs://a' })
    expect(read).toBe(false)
    expect(result.isError).toBe(false)
    expect(result.content).toContain('does not declare the resources capability')
  })

  it('requires server and uri', async () => {
    const result = await executeReadMcpResource(host({
      getResourceCapableSlugs: () => ['docs'],
      getResourceCapabilities: () => ({ resources: true, subscribe: false, listChanged: false }),
    }), { server: 'docs' })
    expect(result.isError).toBe(true)
  })

  it('returns text contents', async () => {
    const result = await executeReadMcpResource(host({
      getResourceCapableSlugs: () => ['docs'],
      getResourceCapabilities: () => ({ resources: true, subscribe: false, listChanged: false }),
      readResource: async (_slug, uri) => ({
        contents: [{ uri, mimeType: 'text/plain', text: 'hello' }],
      }),
    }), { server: 'docs', uri: 'docs://a' })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('hello')
  })

  it('attaches small images and summarizes other blobs', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const image = formatReadResourceResult(
      [{ uri: 'test://image', mimeType: 'image/png', blob: png }],
      { server: 'docs', uri: 'test://image' },
    )
    expect(Array.isArray(image.content)).toBe(true)
    const blocks = image.content as Array<{ type: string; mimeType?: string }>
    expect(blocks.some(block => block.type === 'image' && block.mimeType === 'image/png')).toBe(true)

    const blob = formatReadResourceResult(
      [{ uri: 'test://bin', mimeType: 'application/octet-stream', blob: Buffer.from('zzzz').toString('base64') }],
      { server: 'docs', uri: 'test://bin' },
    )
    expect(typeof blob.content).toBe('string')
    expect(blob.content).toContain('Binary blob')
    expect(blob.content).not.toContain('zzzz')
  })
})
