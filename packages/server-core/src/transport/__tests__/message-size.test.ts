import { describe, expect, it } from 'bun:test'
import { WsRpcClient } from '../client.ts'
import { DEFAULT_MAX_MESSAGE_BYTES } from '@craft-agent/shared/protocol'

function connectedClient(limit?: number) {
  const sent: string[] = []
  const client = new WsRpcClient('ws://127.0.0.1:1', { autoReconnect: false })
  const socket = {
    OPEN: 1,
    readyState: 1,
    send: (data: string) => { sent.push(data) },
  }
  const internal = client as unknown as {
    connected: boolean
    ws: typeof socket
    _maxMessageBytes: number | null
    onMessage: (raw: string) => void
  }
  internal.connected = true
  internal.ws = socket
  if (limit !== undefined) internal._maxMessageBytes = limit
  return { client, sent, internal }
}

describe('WsRpcClient message size', () => {
  it('assumes the smaller limit until the server advertises one', () => {
    const { client } = connectedClient()
    expect(client.getMaxMessageBytes()).toBe(DEFAULT_MAX_MESSAGE_BYTES)
  })

  it('stores the advertised limit from handshake_ack', () => {
    const { client, internal } = connectedClient()
    internal.onMessage(JSON.stringify({
      id: 'ack',
      type: 'handshake_ack',
      clientId: 'client-1',
      maxMessageBytes: 1000,
    }))
    expect(client.getMaxMessageBytes()).toBe(1000)
  })

  it('rejects an oversized request without sending or closing the socket', async () => {
    const { client, sent } = connectedClient(80)
    await expect(client.invoke('sessions:sendMessage', { body: 'x'.repeat(200) })).rejects.toThrow(/Message too large/)
    expect(sent).toEqual([])
  })

  it('sends a request that fits', async () => {
    const { client, sent } = connectedClient(10_000)
    const pending = client.invoke('sessions:ping')
    await Promise.resolve()
    expect(sent).toHaveLength(1)
    const frame = JSON.parse(sent[0]!)
    ;(client as unknown as { onMessage: (raw: string) => void }).onMessage(JSON.stringify({
      id: frame.id,
      type: 'response',
      result: 'ok',
    }))
    await expect(pending).resolves.toBe('ok')
  })
})
