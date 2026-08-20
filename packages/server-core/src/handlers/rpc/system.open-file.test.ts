import { describe, expect, it } from 'bun:test'
import { homedir } from 'os'
import { join, sep } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CLIENT_OPEN_PATH, CLIENT_SHOW_IN_FOLDER } from '@craft-agent/server-core/transport'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  FILE_ACCESS_MISSING_WORKSPACE_MESSAGE,
  FILE_ACCESS_OUTSIDE_ALLOWED_MESSAGE,
} from '../utils'
import { registerSystemCoreHandlers } from './system'

function createTestHarness(overrides?: {
  workspaceId?: string | null
  windowWorkspaceId?: string | null
}) {
  const handlers = new Map<string, HandlerFn>()
  const invokeClientCalls: Array<{ clientId: string; channel: string; args: any[] }> = []

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient(clientId, channel, ...args) {
      invokeClientCalls.push({ clientId, channel, args })
      return {}
    },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }

  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
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
    windowManager: {
      getWorkspaceForWindow: () => overrides?.windowWorkspaceId ?? null,
    } as unknown as HandlerDeps['windowManager'],
  }

  registerSystemCoreHandlers(server, deps)

  const openFile = handlers.get(RPC_CHANNELS.shell.OPEN_FILE)
  const showInFolder = handlers.get(RPC_CHANNELS.shell.SHOW_IN_FOLDER)
  if (!openFile || !showInFolder) {
    throw new Error('OPEN_FILE / SHOW_IN_FOLDER handlers were not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: overrides?.workspaceId === undefined ? 'ws-1' : overrides.workspaceId,
    webContentsId: 101,
  }

  return { openFile, showInFolder, ctx, invokeClientCalls }
}

const homeFile = join(homedir(), '报告.docx')
const forbiddenFile = sep === '\\' ? 'Z:\\forbidden\\secret.docx' : '/forbidden/secret.docx'

describe('registerSystemCoreHandlers OPEN_FILE / SHOW_IN_FOLDER', () => {
  it('opens a file when workspaceId is present', async () => {
    const { openFile, ctx, invokeClientCalls } = createTestHarness({ workspaceId: 'ws-1' })

    await openFile(ctx, homeFile)

    expect(invokeClientCalls).toEqual([{
      clientId: 'client-1',
      channel: CLIENT_OPEN_PATH,
      args: [homeFile],
    }])
  })

  it('opens a file:// Windows-style link that resolves inside home', async () => {
    const { openFile, ctx, invokeClientCalls } = createTestHarness({ workspaceId: 'ws-1' })
    const fileUrl = process.platform === 'win32'
      ? `file:///${homeFile.replace(/\\/g, '/')}`
      : `file://${homeFile}`

    await openFile(ctx, fileUrl)

    expect(invokeClientCalls[0]?.channel).toBe(CLIENT_OPEN_PATH)
    expect(String(invokeClientCalls[0]?.args[0])).toContain('报告.docx')
  })

  it('falls back to the window workspace mapping when workspaceId is missing', async () => {
    const { showInFolder, ctx, invokeClientCalls } = createTestHarness({
      workspaceId: null,
      windowWorkspaceId: 'ws-window',
    })

    await showInFolder(ctx, homeFile)

    expect(invokeClientCalls).toEqual([{
      clientId: 'client-1',
      channel: CLIENT_SHOW_IN_FOLDER,
      args: [homeFile],
    }])
  })

  it('rejects an unauthorized path with an actionable Local Folder hint', async () => {
    const { openFile, ctx } = createTestHarness({ workspaceId: 'ws-1' })

    await expect(openFile(ctx, forbiddenFile)).rejects.toThrow(FILE_ACCESS_OUTSIDE_ALLOWED_MESSAGE)
  })

  it('rejects an unauthorized path with a missing-context hint when no workspace can be resolved', async () => {
    const { showInFolder, ctx } = createTestHarness({
      workspaceId: null,
      windowWorkspaceId: null,
    })

    await expect(showInFolder(ctx, forbiddenFile)).rejects.toThrow(FILE_ACCESS_MISSING_WORKSPACE_MESSAGE)
  })
})
