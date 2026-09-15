import { expect, it } from 'bun:test'
import { handleSubmitAnswer } from './submit-answer'
import type { SessionToolContext } from '../context'
it('delivers the complete body when a provider echoes UI metadata', async () => {
  let body: string | undefined
  const result = await handleSubmitAnswer({ submitAnswer: async markdown => { body = markdown } } as SessionToolContext,
    { markdown: '## 完成\n\n[交付文件](/tmp/result.html)', intent: '交付文件', _displayName: '提交答案' })
  expect(result.isError).not.toBe(true)
  expect(body).toBe('## 完成\n\n[交付文件](/tmp/result.html)')
})
it('still rejects missing or empty markdown without invoking delivery', async () => {
  let calls = 0
  const ctx = { submitAnswer: async () => { calls++ } } as unknown as SessionToolContext
  for (const args of [{ intent: 'done' }, { markdown: '  ' }, { markdown: 123 }]) {
    expect((await handleSubmitAnswer(ctx, args)).isError).toBe(true)
  }
  expect(calls).toBe(0)
})
