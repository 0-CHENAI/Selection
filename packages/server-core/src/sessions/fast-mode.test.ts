import { expect, test } from 'bun:test'
import { SessionManager, createManagedSession } from './SessionManager'

test('session Fast updates the live agent and persisted metadata, but cannot change mid-turn', () => {
  const manager = new SessionManager()
  const internal = manager as any
  const session = createManagedSession({ id: 'fast', fastMode: true }, { id: 'w', name: 'w', rootPath: '/tmp/fast-fixture' } as never)
  expect(session.fastMode).toBe(true)
  const updates: boolean[] = []
  const persisted: boolean[] = []
  session.agent = { setFastMode: (value: boolean) => updates.push(value) } as never
  internal.sessions.set(session.id, session)
  internal.persistSession = (value: typeof session) => persisted.push(value.fastMode!)
  manager.setSessionFastMode(session.id, false)
  expect(session.fastMode).toBe(false)
  manager.setSessionFastMode(session.id, true)
  expect(updates).toEqual([false, true])
  expect(persisted).toEqual([false, true])
  session.isProcessing = true
  expect(() => manager.setSessionFastMode(session.id, false)).toThrow('当前回复')
  expect(session.fastMode).toBe(true)
  expect(updates).toHaveLength(2)
  expect(() => manager.setSessionFastMode('missing', true)).toThrow('Session not found')
})
