#!/usr/bin/env node
// Resources-only MCP stdio server: no tools capability.

import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })
const PROTOCOL_VERSION = '2025-11-25'

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
        capabilities: { resources: {} },
        serverInfo: { name: 'mcp-server-resources-only', version: '1.0.0' },
      },
    })
    return
  }

  if (req.method === 'notifications/initialized') return

  if (req.method === 'resources/list') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        resources: [{ uri: 'test://only', name: 'Only', mimeType: 'text/plain' }],
      },
    })
    return
  }

  if (req.method === 'resources/read') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        contents: [{ uri: req.params?.uri, mimeType: 'text/plain', text: 'only-resource' }],
      },
    })
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
