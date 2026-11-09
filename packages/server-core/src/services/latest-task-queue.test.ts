import { expect, test } from 'bun:test'
import { LatestTaskQueue } from './latest-task-queue'

test('rapid updates run the in-flight and latest request once; final stop wins', async () => {
  const queue = new LatestTaskQueue(), seen: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const first = queue.run('deck', async () => { seen.push('first'); await gate })
  await Promise.resolve()
  const waits = Array.from({ length: 100 }, (_, i) => queue.run('deck', async () => { seen.push(String(i)) }))
  const stopped = queue.run('deck', async () => { seen.push('stopped') })
  release()
  await Promise.all([first, ...waits, stopped])
  expect(seen).toEqual(['first', 'stopped'])
  await queue.run('deck', async () => { seen.push('new turn') })
  expect(seen.at(-1)).toBe('new turn')
})

test('different decks run independently and failures do not poison later requests', async () => {
  const queue = new LatestTaskQueue()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const one = queue.run('one', () => gate)
  let other = false
  await queue.run('two', async () => { other = true })
  expect(other).toBe(true)
  release(); await one
  await expect(queue.run('one', async () => { throw new Error('export failed') })).rejects.toThrow('export failed')
  await queue.run('one', async () => {})
})
