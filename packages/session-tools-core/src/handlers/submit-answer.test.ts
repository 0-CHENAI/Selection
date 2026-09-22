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
it('rejects the delivery receipt so it cannot become the published answer', async () => {
  let calls = 0
  const ctx = { submitAnswer: async () => { calls++ } } as unknown as SessionToolContext
  for (const markdown of ['Answer delivered. Stop here.', 'Answer delivered.']) {
    expect((await handleSubmitAnswer(ctx, { markdown })).isError).toBe(true)
  }
  expect(calls).toBe(0)
})
it('still delivers an answer that only mentions the receipt phrase', async () => {
  let body: string | undefined
  const markdown = 'Answer delivered. Stop here.\n\n# DeepSeek V4.1 Flash\n\n正式正文。'
  const result = await handleSubmitAnswer({ submitAnswer: async value => { body = value } } as SessionToolContext, { markdown })
  expect(result.isError).not.toBe(true)
  expect(body).toBe(markdown)
})
it('still rejects missing or empty markdown without invoking delivery', async () => {
  let calls = 0
  const ctx = { submitAnswer: async () => { calls++ } } as unknown as SessionToolContext
  for (const args of [{ intent: 'done' }, { markdown: '  ' }, { markdown: 123 }, { markdown: 'complete', sessionId: 'another-session' }, { markdown: 'complete', runId: 'forged' }]) {
    expect((await handleSubmitAnswer(ctx, args)).isError).toBe(true)
  }
  expect(calls).toBe(0)
})
