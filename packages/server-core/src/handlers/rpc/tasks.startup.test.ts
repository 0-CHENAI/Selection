import { expect, test } from 'bun:test'
import { registerTasksHandlers } from './tasks'
import type { HandlerDeps } from '../handler-deps'
import type { RpcServer } from '../../transport'

test('startup recovery waits for session initialization without requiring a client request', async () => {
  let ready!: () => void
  const gate = new Promise<void>(resolve => { ready = resolve })
  let enumerated = 0
  registerTasksHandlers({ handle() {} } as unknown as RpcServer, {
    sessionManager: {
      setTaskRunnerLookup() {},
      waitForInit: () => gate,
      getWorkspaces: () => { enumerated++; return [] },
    },
  } as unknown as HandlerDeps)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(enumerated).toBe(0)
  ready()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(enumerated).toBe(1)
})
