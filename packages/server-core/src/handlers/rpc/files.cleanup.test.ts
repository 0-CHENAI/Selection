import { expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerFilesHandlers } from './files'

test('cleanup RPC binds session workspace and requires a retry identity before dispatch', async () => {
  const calls: unknown[][] = []
  const handlers = new Map<string, HandlerFn>()
  registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {
    sessionManager: {
      getSession: async () => ({ workspaceId: 'workspace' }),
      cleanupArtifactVersions: async (...args: unknown[]) => { calls.push(args); return { id: 'artifact' } },
    },
  } as unknown as HandlerDeps)
  const cleanup = handlers.get(RPC_CHANNELS.artifacts.CLEANUP)!
  const context = { clientId: 'client', workspaceId: 'workspace' } as RequestContext
  await expect(cleanup({ ...context, workspaceId: 'other' }, 'session', 'artifact', 'current', ['old'], 'request')).rejects.toThrow('does not belong')
  await expect(cleanup({ clientId: 'client' } as RequestContext, 'session', 'artifact', 'current', ['old'], 'request')).rejects.toThrow('Workspace required')
  await expect(cleanup(context, 'session', 'artifact', 'current', ['old'], '')).rejects.toThrow('Invalid cleanup')
  await expect(cleanup(context, 'session', 'artifact', 'current', [], 'request')).rejects.toThrow('Invalid cleanup')
  expect(calls).toHaveLength(0)
  expect(await cleanup(context, 'session', 'artifact', 'current', ['old'], 'request')).toEqual({ id: 'artifact' })
  expect(calls).toEqual([['session', 'artifact', 'current', ['old'], 'request']])
})
