import { expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { SessionManager } from '../../sessions/SessionManager'
import type { HandlerFn, RpcServer, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

test.each([null, 12])('RPC creation announces authoritative metadata to peer windows (webContentsId=%s)', async webContentsId => {
  const manager = new SessionManager()
  const events: unknown[] = []
  manager.setEventSink((_channel, _target, event) => events.push(event))
  const handlers = new Map<string, HandlerFn>()
  const session = { id: 'pro', workspaceId: 'workspace', name: 'PRO research', workMode: 'PRO', permissionMode: 'safe', messages: [] }
  try {
    registerSessionsHandlers({ handle: (channel: string, handler: HandlerFn) => { handlers.set(channel, handler) } } as unknown as RpcServer, {
      sessionManager: {
        createSession: async (workspaceId: string, _options: unknown, internal?: { emitCreatedEvent?: boolean }) => {
          if (internal?.emitCreatedEvent !== false) manager.notifySessionCreated(workspaceId, session.id)
          return session
        },
      },
      platform: { logger: { info() {}, error() {} } },
    } as unknown as HandlerDeps)
    const context: RequestContext = { clientId: 'creator', workspaceId: 'workspace', webContentsId }
    const created = await handlers.get(RPC_CHANNELS.sessions.CREATE)!(context, 'workspace', { workMode: 'PRO', permissionMode: 'safe' })
    expect(created).toEqual(session)
    expect(events).toEqual([{ type: 'session_created', sessionId: 'pro' }])
  } finally { manager.cleanup() }
})
