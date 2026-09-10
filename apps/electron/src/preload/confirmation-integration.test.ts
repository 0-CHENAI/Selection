import { describe, expect, test } from 'bun:test'
import { registerAuthHandlers } from '../../../../packages/server-core/src/handlers/rpc/auth'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { createConfirmationBridge } from './confirmation-bridge'
import { WsRpcServer } from '../../../../packages/server-core/src/transport/server'
import { WsRpcClient } from '../../../../packages/server-core/src/transport/client'

describe('business confirmations route to the initiating client', () => {
  test('real WebSocket requests return only the initiating local/remote client decision', async () => {
    const token = 'confirmation-integration-test-token'
    const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token, serverId: 'confirmation-test' })
    registerAuthHandlers(server, {} as any)
    await server.listen()
    const clients: WsRpcClient[] = []
    const calls = [0, 0]
    try {
      for (const [index, mode] of (['local', 'remote'] as const).entries()) {
        const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: 'test', mode, autoReconnect: false, clientCapabilities: ['client:confirmDialog'] })
        clients.push(client)
        const bridge = createConfirmationBridge()
        bridge.register(async spec => { calls[index]++; expect(spec.kind).toBe('deleteSession'); return { response: index === 0 ? 1 : 0 } })
        client.handleCapability('client:confirmDialog', spec => bridge.request(spec))
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { off(); reject(new Error('Confirmation client handshake timed out')) }, 2000)
          const off = client.onConnectionStateChanged(state => {
            if (state.status === 'connected') { clearTimeout(timer); off(); resolve() }
          })
          client.connect()
        })
      }
      expect(await clients[0]!.invoke(RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION, 'local')).toBe(true)
      expect(calls).toEqual([1, 0])
      expect(await clients[1]!.invoke(RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION, 'remote')).toBe(false)
      expect(calls).toEqual([1, 1])
    } finally {
      clients.forEach(client => client.destroy())
      await server.close()
    }
  })
  for (const clientId of ['local-window', 'remote-window']) {
    test(`${clientId}: cancel cannot authorize deletion and approval returns once`, async () => {
      const handlers = new Map<string, (...args: any[]) => Promise<any>>()
      const bridge = createConfirmationBridge()
      const requests: Array<{ clientId: string; kind?: string; name?: string }> = []
      const server = {
        handle(channel: string, handler: (...args: any[]) => Promise<any>) { handlers.set(channel, handler) },
        async invokeClient(id: string, capability: string, spec: any) {
          expect(capability).toBe('client:confirmDialog')
          requests.push({ clientId: id, kind: spec.kind, name: spec.name })
          return bridge.request(spec)
        },
      }
      registerAuthHandlers(server as any, {} as any)
      const confirm = handlers.get(RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION)!
      expect(await confirm({ clientId }, 'report')).toBe(false)
      bridge.register(async () => ({ response: 0 }))
      expect(await confirm({ clientId }, 'report')).toBe(false)
      bridge.register(async () => ({ response: 1 }))
      expect(await confirm({ clientId }, 'report')).toBe(true)
      expect(requests).toEqual(Array(3).fill({ clientId, kind: 'deleteSession', name: 'report' }))
      expect(await handlers.get(RPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION)!({ clientId })).toBe(true)
      expect(requests.at(-1)?.kind).toBe('logout')
    })
  }
})
