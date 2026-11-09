import { expect, test } from 'bun:test'
import { ModelConfigurationQueue } from './model-configuration-queue'
import { constrainThinkingLevel, type ThinkingLevel } from '../../shared/src/agent/thinking-levels'

test('effort updates and the next prompt wait for an asynchronous model switch', async () => {
  const queue = new ModelConfigurationQueue()
  let release!: () => void
  const switching = new Promise<void>(resolve => { release = resolve })
  let supported: ThinkingLevel[] = ['low']
  let effective: ThinkingLevel = 'low'
  const switchModel = queue.enqueue(async () => { await switching; supported = ['low', 'high', 'xhigh'] })
  const setEffort = queue.enqueue(async () => { effective = constrainThinkingLevel('xhigh', supported) })
  const nextPrompt = queue.ready().then(() => effective)
  expect(effective).toBe('low')
  release()
  await Promise.all([switchModel, setEffort])
  expect(await nextPrompt).toBe('xhigh')
})

test('rapid model switches retain order and a failed update does not block later changes', async () => {
  const queue = new ModelConfigurationQueue()
  const seen: string[] = []
  const failed = queue.enqueue(async () => { throw new Error('unavailable model') })
  const a = queue.enqueue(async () => { await Promise.resolve(); seen.push('model-a') })
  const b = queue.enqueue(async () => { seen.push('effort-a') })
  const c = queue.enqueue(async () => { seen.push('model-b') })
  const d = queue.enqueue(async () => { seen.push('effort-b') })
  await expect(failed).rejects.toThrow('unavailable model')
  await Promise.all([a, b, c, d, queue.ready()])
  expect(seen).toEqual(['model-a', 'effort-a', 'model-b', 'effort-b'])
})
