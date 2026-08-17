import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '../../../shared/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

type HandlerFn = (ctx: { clientId: string }, ...args: any[]) => Promise<any> | any

const getDefaultThinkingLevelMock = mock(() => 'think')
const setDefaultThinkingLevelMock = mock((_level: string) => true)
const getSharedProjectMemoryEnabledMock = mock(() => false)
const setSharedProjectMemoryEnabledMock = mock((_enabled: boolean) => true)

mock.module('@craft-agent/shared/config', () => ({
  getPreferencesPath: () => '/tmp/preferences.json',
  getSessionDraft: () => null,
  setSessionDraft: () => {},
  deleteSessionDraft: () => {},
  getAllSessionDrafts: () => ({}),
  getWorkspaceByNameOrId: () => null,
  getDefaultThinkingLevel: getDefaultThinkingLevelMock,
  setDefaultThinkingLevel: setDefaultThinkingLevelMock,
  getSharedProjectMemoryEnabled: getSharedProjectMemoryEnabledMock,
  setSharedProjectMemoryEnabled: setSharedProjectMemoryEnabledMock,
}))

describe('settings default thinking RPC handlers', () => {
  const handlers = new Map<string, HandlerFn>()

  beforeEach(async () => {
    handlers.clear()
    getDefaultThinkingLevelMock.mockClear()
    setDefaultThinkingLevelMock.mockClear()
    getSharedProjectMemoryEnabledMock.mockClear()
    setSharedProjectMemoryEnabledMock.mockClear()

    const server: RpcServer = {
      handle(channel, handler) {
        handlers.set(channel, handler as HandlerFn)
      },
      push() {},
      async invokeClient() {
        return null
      },
      hasClientCapability() { return false },
      findClientsWithCapability() { return [] },
    }

    const deps: HandlerDeps = {
      sessionManager: {} as HandlerDeps['sessionManager'],
      platform: {
        appRootPath: '',
        resourcesPath: '',
        isPackaged: false,
        appVersion: '0.0.0-test',
        isDebugMode: true,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        },
        imageProcessor: {
          getMetadata: async () => null,
          process: async () => Buffer.from(''),
        },
      },
      oauthFlowStore: {
        store: () => {},
        getByState: () => null,
        remove: () => {},
        cleanup: () => {},
        dispose: () => {},
        get size() { return 0 },
      } as unknown as HandlerDeps['oauthFlowStore'],
    }

    const { registerSettingsHandlers } = await import('@craft-agent/server-core/handlers/rpc/settings')
    registerSettingsHandlers(server, deps)
  })

  it('returns persisted default thinking level', async () => {
    const getHandler = handlers.get(RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL)
    expect(getHandler).toBeTruthy()

    const result = await getHandler!({ clientId: 'client-1' })
    expect(result).toBe('think')
    expect(getDefaultThinkingLevelMock).toHaveBeenCalledTimes(1)
  })

  it('persists valid thinking level values', async () => {
    const setHandler = handlers.get(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL)
    expect(setHandler).toBeTruthy()

    const result = await setHandler!({ clientId: 'client-1' }, 'max')
    expect(result).toEqual({ success: true })
    expect(setDefaultThinkingLevelMock).toHaveBeenCalledWith('max')
    expect(setDefaultThinkingLevelMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid thinking level values before persistence', async () => {
    const setHandler = handlers.get(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL)
    expect(setHandler).toBeTruthy()

    await expect(setHandler!({ clientId: 'client-1' }, 'ultra')).rejects.toThrow('Invalid thinking level')
    expect(setDefaultThinkingLevelMock).not.toHaveBeenCalled()
  })

  it('returns and persists the shared project memory setting', async () => {
    const getHandler = handlers.get(RPC_CHANNELS.settings.GET_SHARED_PROJECT_MEMORY_ENABLED)
    const setHandler = handlers.get(RPC_CHANNELS.settings.SET_SHARED_PROJECT_MEMORY_ENABLED)
    expect(getHandler).toBeTruthy()
    expect(setHandler).toBeTruthy()

    expect(await getHandler!({ clientId: 'client-1' })).toBe(false)
    expect(await setHandler!({ clientId: 'client-1' }, true)).toEqual({ success: true })
    expect(getSharedProjectMemoryEnabledMock).toHaveBeenCalledTimes(1)
    expect(setSharedProjectMemoryEnabledMock).toHaveBeenCalledWith(true)
  })

  it('rejects non-boolean shared project memory values', async () => {
    const setHandler = handlers.get(RPC_CHANNELS.settings.SET_SHARED_PROJECT_MEMORY_ENABLED)

    await expect(setHandler!({ clientId: 'client-1' }, 'true')).rejects.toThrow('must be a boolean')
    expect(setSharedProjectMemoryEnabledMock).not.toHaveBeenCalled()
  })
})
