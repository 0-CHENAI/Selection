import { expect, test } from 'bun:test'
import { SessionManager, createManagedSession } from './SessionManager'

test('cleanup releases every agent backend once while retaining session history', () => {
  const manager = new SessionManager()
  const workspace = { id: 'ws', slug: 'test', name: 'Test', rootPath: '/tmp/cleanup-runtime-test', createdAt: 0 }
  const sessions = (manager as unknown as { sessions: Map<string, ReturnType<typeof createManagedSession>> }).sessions
  const destroyed: string[] = []
  for (const id of ['root', 'worker']) {
    const session = createManagedSession({ id }, workspace)
    session.agent = { destroy: () => destroyed.push(id) } as never
    sessions.set(id, session)
  }
  manager.cleanup()
  manager.cleanup()
  expect(destroyed).toEqual(['root', 'worker'])
  expect(sessions.size).toBe(2)
  expect([...sessions.values()].every(session => session.agent === null)).toBe(true)
})
