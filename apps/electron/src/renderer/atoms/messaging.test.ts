import { afterEach, describe, expect, it, mock } from 'bun:test'
import { createStore } from 'jotai'
import { messagingDialogAtom, openMessagingPairingAtom } from './messaging'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

function setup(connected: boolean, platform = 'lark') {
  const binding = { id: 'a', platform, workspaceId: 'ws', sessionId: 's1', enabled: true }
  const api = {
    getMessagingConfig: async () => ({ runtime: { [platform]: { connected } } }),
    getMessagingBindings: async () => [
      binding, { ...binding, workspaceId: 'other' }, { ...binding, sessionId: 's2' },
      { ...binding, enabled: false }, { ...binding, platform: 'retired' },
    ],
    generateMessagingPairingCode: mock(async (_sessionId: string, _platform: string) => ({ code: '012345', expiresAt: Date.now() + 300_000 })),
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: api } })
  return { api, store: createStore(), binding }
}

describe('session messaging pairing', () => {
  it('issues a code specifically for the selected WeChat session', async () => {
    const { store, api, binding } = setup(true, 'weixin')
    await store.set(openMessagingPairingAtom, 'ws', 's1', 'weixin')
    expect(api.generateMessagingPairingCode).toHaveBeenCalledWith('s1', 'weixin')
    expect(store.get(messagingDialogAtom)).toMatchObject({ platform: 'weixin', existingBindings: [binding] })
  })

  it('routes disconnected workspaces to setup without issuing a code', async () => {
    const { store, api } = setup(false)
    await store.set(openMessagingPairingAtom, 'ws', 's1')
    expect(store.get(messagingDialogAtom)).toMatchObject({ needsConnection: true, code: null })
    expect(api.generateMessagingPairingCode).not.toHaveBeenCalled()
  })

  it('keeps the selected session and only its active Feishu chats in the dialog', async () => {
    const { store, api, binding } = setup(true)
    await store.set(openMessagingPairingAtom, 'ws', 's1')
    expect(api.generateMessagingPairingCode).toHaveBeenCalledWith('s1', 'lark')
    expect(store.get(messagingDialogAtom)).toMatchObject({ code: '012345', existingBindings: [binding] })
  })

  it('ignores a delayed code after the user switches to another session', async () => {
    const { store, api } = setup(true)
    const requested = Promise.withResolvers<void>()
    const delayed = Promise.withResolvers<{ code: string; expiresAt: number }>()
    api.generateMessagingPairingCode.mockImplementationOnce(() => {
      requested.resolve()
      return delayed.promise
    })
    const first = store.set(openMessagingPairingAtom, 'ws', 's1')
    await requested.promise
    await store.set(openMessagingPairingAtom, 'ws', 's3')
    delayed.resolve({ code: '000000', expiresAt: 1 })
    await first
    expect(store.get(messagingDialogAtom)).toMatchObject({ sessionId: 's3', code: '012345', existingBindings: [] })
  })
})
