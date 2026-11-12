import { describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CraftMcpClient } from '../client.ts'
import { validateStdioMcpConnection } from '../validation.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = (name: string) => join(HERE, 'fixtures', name)

describe('CraftMcpClient resource capability gating', () => {
  it(
    'does not throw resources/* on a tools-only server',
    async () => {
      const client = new CraftMcpClient({
        transport: 'stdio',
        command: 'node',
        args: [FIXTURE('mcp-server-good.mjs')],
      })
      try {
        await client.connect()
        expect(client.supportsResources()).toBe(false)
        expect(client.getResourceCapabilities()).toEqual({
          resources: false,
          subscribe: false,
          listChanged: false,
        })
        await expect(client.listResources()).resolves.toEqual({ resources: [] })
        await expect(client.listResourceTemplates()).resolves.toEqual({ resourceTemplates: [] })
        await expect(client.readResource('test://x')).resolves.toEqual({ contents: [] })
        await expect(client.subscribeResource('test://x')).resolves.toBeUndefined()
        await expect(client.unsubscribeResource('test://x')).resolves.toBeUndefined()
        client.enableResourceNotifications({
          onListChanged: () => {
            throw new Error('listChanged handler must not run without the capability')
          },
        })
      } finally {
        await client.close()
      }
    },
    15000,
  )

  it(
    'lists and reads resources when the server declared the capability',
    async () => {
      const client = new CraftMcpClient({
        transport: 'stdio',
        command: 'node',
        args: [FIXTURE('mcp-server-resources.mjs')],
      })
      try {
        await client.connect()
        expect(client.getResourceCapabilities()).toEqual({
          resources: true,
          subscribe: true,
          listChanged: true,
        })
        const first = await client.listResources()
        expect(first.resources[0]?.uri).toBe('test://doc/a')
        expect(first.nextCursor).toBe('page-2')
        const second = await client.listResources(first.nextCursor)
        expect(second.resources[0]?.uri).toBe('test://doc/b')
        const templates = await client.listResourceTemplates()
        expect(templates.resourceTemplates[0]?.uriTemplate).toBe('test://item/{id}')
        const read = await client.readResource('test://doc/a')
        expect(read.contents[0]?.text).toContain('hello from test://doc/a')
        await expect(client.subscribeResource('test://doc/a')).resolves.toBeUndefined()
      } finally {
        await client.close()
      }
    },
    15000,
  )

  it(
    'connects to a resources-only server without calling tools/list',
    async () => {
      const client = new CraftMcpClient({
        transport: 'stdio',
        command: 'node',
        args: [FIXTURE('mcp-server-resources-only.mjs')],
      })
      try {
        await client.connect()
        expect(client.supportsTools()).toBe(false)
        expect(client.supportsResources()).toBe(true)
        expect(await client.listTools()).toEqual([])
        const listed = await client.listResources()
        expect(listed.resources[0]?.uri).toBe('test://only')
      } finally {
        await client.close()
      }
    },
    15000,
  )
})

describe('validateStdioMcpConnection resource-only servers', () => {
  it(
    'succeeds without tools/list when the server omitted the tools capability',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-resources-only.mjs')],
        timeout: 8000,
      })
      expect(result.success).toBe(true)
      expect(result.tools).toEqual([])
    },
    15000,
  )
})
