import { expect, test } from 'bun:test'
import { PptPreviewCache } from './preview-cache'

test('preview cache coalesces requests, bounds UTF-16 bytes and evicts least recently used', async () => {
  const cache = new PptPreviewCache(12)
  let calls = 0
  const load = async () => { calls++; return 'abc' }
  const first = cache.get('a', load)
  expect(cache.get('a', load)).toBe(first)
  await first
  await cache.get('b', load)
  await cache.get('a', load)
  await cache.get('c', load)
  expect(calls).toBe(3)
  await cache.get('b', load)
  expect(calls).toBe(4)
  await cache.get('large', async () => 'too large for this cache')
  await cache.get('large', async () => { calls++; return 'oversized' })
  expect(calls).toBe(5)
})

test('failed requests retry and refresh cannot repopulate stale previews', async () => {
  const cache = new PptPreviewCache()
  await expect(cache.get('a', async () => { throw new Error('offline') })).rejects.toThrow('offline')
  expect(await cache.get('a', async () => 'recovered')).toBe('recovered')
  let resolve!: (value: string) => void
  const pending = cache.get('b', () => new Promise<string>(done => { resolve = done }))
  await Promise.resolve()
  cache.clear()
  resolve('stale')
  await pending
  expect(await cache.get('b', async () => 'fresh')).toBe('fresh')
})
