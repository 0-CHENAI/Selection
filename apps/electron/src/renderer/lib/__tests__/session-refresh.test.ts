import { expect, it } from 'bun:test'
import type { Session } from '../../../shared/types'
import { refreshSessionSnapshot } from '../session-refresh'

it.each([false, true])('does not overwrite a live completion/new turn with a delayed snapshot (newTurn=%s)', async newTurn => {
  let current = { id: 's', isProcessing: true, messages: [] } as unknown as Session
  const old = current
  let release!: (session: Session) => void
  let applied = false
  const refresh = refreshSessionSnapshot(() => current, () => new Promise(resolve => { release = resolve }), next => {
    applied = true
    current = next
  })
  current = { ...current, isProcessing: newTurn, messages: [{ id: 'new', content: 'new state' }] } as Session
  release(old)
  expect(await refresh).toBe('superseded')
  expect(applied).toBe(false)
  expect(current.messages[0]?.id).toBe('new')
})

it('repairs stale processing state while retaining messages omitted from the snapshot', async () => {
  let current = { id: 's', isProcessing: true, messages: [{ id: 'saved' }] } as Session
  const result = await refreshSessionSnapshot(() => current,
    async () => ({ ...current, isProcessing: false, messages: [] }), next => { current = next })
  expect(result).toBe('preserved_stale_messages')
  expect(current.isProcessing).toBe(false)
  expect(current.messages[0]?.id).toBe('saved')
})
