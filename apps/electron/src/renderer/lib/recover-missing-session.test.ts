import { expect, test } from 'bun:test'
import { recoverMissingSession } from './recover-missing-session'
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

test('each route visit can recover the same deleted session', async () => {
  let navigations = 0
  for (let visit = 0; visit < 2; visit++) {
    const cleanup = recoverMissingSession(async () => null, () => navigations++, () => {})
    await flush()
    cleanup()
  }
  expect(navigations).toBe(2)
})

test('late replies after leaving a route never navigate', async () => {
  let resolve!: (session: null) => void
  let navigations = 0
  const cleanup = recoverMissingSession(() => new Promise(r => { resolve = r }), () => navigations++, () => {})
  cleanup()
  resolve(null)
  await flush()
  expect(navigations).toBe(0)
})

test('existing sessions and transport failures are not treated as deletion', async () => {
  let navigations = 0
  let errors = 0
  recoverMissingSession(async () => ({ id: 'exists' }), () => navigations++, () => errors++)
  recoverMissingSession(async () => { throw new Error('offline') }, () => navigations++, () => errors++)
  await flush()
  expect(navigations).toBe(0)
  expect(errors).toBe(1)
})
