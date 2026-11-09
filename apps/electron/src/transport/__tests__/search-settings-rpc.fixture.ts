import assert from 'node:assert/strict'
import { registerSettingsHandlers } from '@craft-agent/server-core/handlers/rpc/settings'
import { WsRpcServer, WsRpcClient } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { buildClientApi } from '../build-api'
import { CHANNEL_MAP } from '../channel-map'

const token = 'search-settings-isolated-test-token'

async function connect(server: WsRpcServer) {
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: 'test', autoReconnect: false })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Handshake timed out')) }, 3000)
    const off = client.onConnectionStateChanged(state => {
      if (state.status === 'connected') { clearTimeout(timer); off(); resolve() }
      else if (state.status === 'failed') { clearTimeout(timer); off(); reject(new Error('Connection failed')) }
    })
    client.connect()
  })
  return client
}

const options = { host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async (value: string) => value === token, serverId: 'search-test' }
const server = new WsRpcServer(options)
registerSettingsHandlers(server, {} as any)
await server.listen()
const client = await connect(server)
try {
  const api = buildClientApi(client, CHANNEL_MAP, channel => client.isChannelAvailable(channel))
  assert.equal(api.isChannelAvailable(RPC_CHANNELS.settings.SET_SEARCH_SETTINGS), true)
  assert.equal((await api.getAdvancedSettings()).searchSettings, null)
  const settings = await api.setSearchSettings({ providers: [{ id: 'exa', enabled: true }, { id: 'native', enabled: false }] })
  assert.deepEqual(settings.providers.slice(0, 2), [{ id: 'exa', enabled: true }, { id: 'native', enabled: false }])
  assert.deepEqual((await api.getAdvancedSettings()).searchSettings, settings)
  await api.setSearchProviderApiKey('exa', 'isolated-test-key')
  const saved = await api.getAdvancedSettings()
  assert.equal(saved.searchKeysConfigured?.exa, true)
  assert.equal(JSON.stringify(saved).includes('isolated-test-key'), false)
  await assert.rejects(api.setSearchSettings({ providers: [{ id: 'exa', enabled: true }, { id: 'exa', enabled: false }] }), /Invalid search provider settings/)
  assert.deepEqual((await api.getAdvancedSettings()).searchSettings, settings)
} finally {
  client.destroy()
  await server.close()
}

// Older running servers must report the new channel as unavailable, rather than
// accepting a reorder in the UI and failing only after the user drops it.
const oldServer = new WsRpcServer(options)
await oldServer.listen()
const oldClient = await connect(oldServer)
try {
  assert.equal(oldClient.isChannelAvailable(RPC_CHANNELS.settings.SET_SEARCH_SETTINGS), false)
  await assert.rejects(oldClient.invoke(RPC_CHANNELS.settings.SET_SEARCH_SETTINGS, {}), (error: any) => error.code === 'CHANNEL_NOT_FOUND')
} finally {
  oldClient.destroy()
  await oldServer.close()
}
// WsRpcServer keeps handler timeout timers alive after replies; the isolated
// process has finished every assertion and can exit without waiting for them.
process.exit(0)
