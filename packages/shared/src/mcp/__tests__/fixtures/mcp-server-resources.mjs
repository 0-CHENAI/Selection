#!/usr/bin/env node
// MCP stdio server that declares tools + resources (subscribe + listChanged).

import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })
const PROTOCOL_VERSION = '2025-11-25'
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const send = (msg) => {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

rl.on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }

  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: { subscribe: true, listChanged: true },
        },
        serverInfo: { name: 'mcp-server-resources', version: '1.0.0' },
      },
    })
    return
  }

  if (req.method === 'notifications/initialized') return

  if (req.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: [
          {
            name: 'ping',
            description: 'Ping',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    })
    return
  }

  if (req.method === 'resources/list') {
    const cursor = req.params?.cursor
    if (cursor === 'page-2') {
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          resources: [
            { uri: 'test://doc/b', name: 'Doc B', mimeType: 'text/plain' },
          ],
        },
      })
      return
    }
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        resources: [
          { uri: 'test://doc/a', name: 'Doc A', description: 'First doc', mimeType: 'text/plain' },
        ],
        nextCursor: 'page-2',
      },
    })
    return
  }

  if (req.method === 'resources/templates/list') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        resourceTemplates: [
          {
            uriTemplate: 'test://item/{id}',
            name: 'Item',
            description: 'Fill {id} then read',
            mimeType: 'text/plain',
          },
        ],
      },
    })
    return
  }

  if (req.method === 'resources/read') {
    const uri = req.params?.uri
    if (uri === 'test://doc/a' || uri === 'test://doc/b') {
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          contents: [{ uri, mimeType: 'text/plain', text: `hello from ${uri}` }],
        },
      })
      return
    }
    if (uri === 'test://image') {
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          contents: [{ uri, mimeType: 'image/png', blob: PNG }],
        },
      })
      return
    }
    if (uri === 'test://blob') {
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          contents: [{ uri, mimeType: 'application/octet-stream', blob: Buffer.from('not-an-image').toString('base64') }],
        },
      })
      return
    }
    send({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32002, message: `Unknown resource: ${uri}` },
    })
    return
  }

  if (req.method === 'resources/subscribe' || req.method === 'resources/unsubscribe') {
    send({ jsonrpc: '2.0', id: req.id, result: {} })
    return
  }

  if (typeof req.id !== 'undefined') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32601, message: 'Method not found' },
    })
  }
})
