import { expect, test } from 'bun:test'
import { createDraftDisplaySession, createDraftSubmission, DRAFT_SESSION_OPTIONS_ID } from './draft-session'

test('draft display session keeps a stable id so ChatDisplay can stay mounted', () => {
  const session = createDraftDisplaySession({
    workspaceId: 'ws',
    model: 'laufry',
    llmConnection: 'default',
  })
  expect(session.id).toBe(DRAFT_SESSION_OPTIONS_ID)
  expect(session.messages).toEqual([])
  expect(session.model).toBe('laufry')
})


test('draft is lazy and concurrent submissions create and send only once', async () => {
  let creates = 0
  let sends = 0
  let resolve!: (value: string) => void
  const submit = createDraftSubmission(() => {
    creates++
    return new Promise<string>(r => { resolve = r })
  })
  expect(creates).toBe(0)
  const first = submit(() => { sends++ })
  expect(await submit(() => { sends++ })).toBe(false)
  resolve('session')
  expect(await first).toBe(true)
  expect(creates).toBe(1)
  expect(sends).toBe(1)
})

test('failed create can retry; failed send reuses the created session', async () => {
  let creates = 0
  const submit = createDraftSubmission(async () => {
    if (++creates === 1) throw new Error('create failed')
    return 'project-session'
  })
  await expect(submit(() => {})).rejects.toThrow('create failed')
  await expect(submit(() => { throw new Error('send failed') })).rejects.toThrow('send failed')
  let sent = ''
  expect(await submit(id => { sent = id })).toBe(true)
  expect(sent).toBe('project-session')
  expect(creates).toBe(2)
})
