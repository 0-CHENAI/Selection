import { expect, it } from 'bun:test'
import { finishWorkbenchCreation } from '../workbench-first-run'

it('saving a new task never invokes its runner', async () => {
  const calls: string[] = []
  await finishWorkbenchCreation(false, async () => { calls.push('run') }, () => calls.push('leave'))
  expect(calls).toEqual(['leave'])
})

it('waits for the explicit first run before leaving create mode', async () => {
  const calls: string[] = []
  const result = await finishWorkbenchCreation(true, async () => {
    calls.push('run')
    await Promise.resolve()
    calls.push('started')
    return { runId: 'first-run' }
  }, () => calls.push('leave'))
  expect(result).toEqual({ runId: 'first-run' })
  expect(calls).toEqual(['run', 'started', 'leave'])
})

it('preserves the committed task when its first run is rejected', async () => {
  let left = 0
  const failure = new Error('Run rejected')
  await expect(finishWorkbenchCreation(true, async () => { throw failure }, () => { left++ })).rejects.toBe(failure)
  expect(left).toBe(1)
})

it('leaves creation mode without running when document association fails', async () => {
  const calls: string[] = []
  const failure = new Error('Association conflict')
  await expect(finishWorkbenchCreation(true,
    async () => { calls.push('run') },
    () => { calls.push('leave') },
    async () => { calls.push('link'); throw failure },
  )).rejects.toBe(failure)
  expect(calls).toEqual(['link', 'leave'])
})

it('associates the document before the explicit first run', async () => {
  const calls: string[] = []
  await finishWorkbenchCreation(true,
    async () => { calls.push('run') },
    () => { calls.push('leave') },
    async () => { calls.push('link') },
  )
  expect(calls).toEqual(['link', 'run', 'leave'])
})
