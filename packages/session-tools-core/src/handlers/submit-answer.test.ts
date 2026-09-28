import { expect, it } from 'bun:test'
import { handleSubmitAnswer } from './submit-answer'
import type { SessionToolContext } from '../context'
it('delivers the complete body when a provider echoes UI metadata', async () => {
  let body: string | undefined
  const result = await handleSubmitAnswer({ submitAnswer: async markdown => { body = markdown } } as SessionToolContext,
    { markdown: '## 完成\n\n[交付文件](/tmp/result.html)', featuredArtifacts: ['/tmp/result.html'], intent: '交付文件', _displayName: '提交答案' })
  expect(result.isError).not.toBe(true)
  expect(body).toBe('## 完成\n\n[交付文件](/tmp/result.html)')
})
it('passes the AI-written artifact version title separately from the visible answer', async () => {
  let delivered: [string, string | undefined] | undefined
  const result = await handleSubmitAnswer({ submitAnswer: async (markdown, title) => { delivered = [markdown, title] } } as SessionToolContext,
    { markdown: '[报告](/tmp/report.docx)', featuredArtifacts: ['/tmp/report.docx'], artifactVersionTitle: '修复目录分页并统一表格格式' })
  expect(result.isError).not.toBe(true)
  expect(delivered).toEqual(['[报告](/tmp/report.docx)', '修复目录分页并统一表格格式'])
})
it('rejects the delivery receipt so it cannot become the published answer', async () => {
  let calls = 0
  const ctx = { submitAnswer: async () => { calls++ } } as unknown as SessionToolContext
  for (const markdown of ['Answer delivered. Stop here.', 'Answer delivered.']) {
    expect((await handleSubmitAnswer(ctx, { markdown, featuredArtifacts: [] })).isError).toBe(true)
  }
  expect(calls).toBe(0)
})
it('still delivers an answer that only mentions the receipt phrase', async () => {
  let body: string | undefined
  const markdown = 'Answer delivered. Stop here.\n\n# DeepSeek V4.1 Flash\n\n正式正文。'
  const result = await handleSubmitAnswer({ submitAnswer: async value => { body = value } } as SessionToolContext, { markdown, featuredArtifacts: [] })
  expect(result.isError).not.toBe(true)
  expect(body).toBe(markdown)
})
it('still rejects missing or empty markdown without invoking delivery', async () => {
  let calls = 0
  const ctx = { submitAnswer: async () => { calls++ } } as unknown as SessionToolContext
  for (const args of [{ intent: 'done' }, { markdown: '  ', featuredArtifacts: [] }, { markdown: 123, featuredArtifacts: [] }, { markdown: 'complete', featuredArtifacts: [], sessionId: 'another-session' }, { markdown: 'complete', featuredArtifacts: [], runId: 'forged' }]) {
    expect((await handleSubmitAnswer(ctx, args)).isError).toBe(true)
  }
  expect(calls).toBe(0)
})
it('requires a deliberate result selection and passes it separately from the answer', async () => {
  let featured: string[] | undefined
  const ctx = { submitAnswer: async (_markdown: string, _title: string | undefined, paths: string[] | undefined) => { featured = paths } } as SessionToolContext
  expect((await handleSubmitAnswer(ctx, { markdown: '[数据](data.json)' })).isError).toBe(true)
  expect((await handleSubmitAnswer(ctx, { markdown: '[数据](data.json)', featuredArtifacts: [] })).isError).not.toBe(true)
  expect(featured).toEqual([])
  expect((await handleSubmitAnswer(ctx, { markdown: '[报告](report.html)', featuredArtifacts: ['report.html'] })).isError).not.toBe(true)
  expect(featured).toEqual(['report.html'])
})
