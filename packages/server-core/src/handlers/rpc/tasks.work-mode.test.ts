import { expect, test, spyOn } from 'bun:test'
import * as storage from '@craft-agent/shared/config/storage'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { registerTasksHandlers } from './tasks'
import type { HandlerDeps } from '../handler-deps'
import type { RpcServer } from '../../transport'

test('UI/backend DAG start rejects NORM even with the global switch enabled', async () => {
  const globalSwitch = spyOn(storage, 'getDagOrchestrationEnabled').mockReturnValue(true)
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  let runnerRequested = false
  try {
    registerTasksHandlers({ handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) } as unknown as RpcServer, {
      sessionManager: {
        setTaskRunnerLookup() {},
        getSession: async () => ({ id: 'norm', workspaceId: 'workspace', workMode: 'NORM', permissionMode: 'allow-all', swarmEnabled: true }),
        getWorkspace: () => { runnerRequested = true; throw new Error('Execution side effect') },
      },
    } as unknown as HandlerDeps)
    await expect(handlers.get(RPC_CHANNELS.tasks.RUN)!({}, 'workspace', { slug: 'absent', orchestratorSessionId: 'norm' })).rejects.toThrow('NORM')
    expect(runnerRequested).toBe(false)
  } finally { globalSwitch.mockRestore() }
})
