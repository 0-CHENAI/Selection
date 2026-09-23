import { expect, it } from 'bun:test'
import { AnswerBoundary, FINAL_ANSWER_MARKER as marker, MARKER_ANSWER_PROMPT } from './answer-boundary'
function create(log: string[] = []) { let id = 0; return new AnswerBoundary(() => `m-${++id}`, n => log.push(n)) }
it('keeps the final-answer protocol aligned with the separate source panel', () => {
  expect(MARKER_ANSWER_PROMPT).toContain('put citations next to the claims they support')
  expect(MARKER_ANSWER_PROMPT).toContain('do not append a Sources/数据来源 list')
})
it('splits at every transport boundary without leaking the marker or mixing bodies', () => {
  const text = `查询完毕。\n${marker}\r\n第一段。\n\n第二段。`
  for (let i = 0; i <= text.length; i++) {
    const p = create(); const events = [...p.push(text.slice(0, i)), ...p.push(text.slice(i)), ...p.finish(true, 'sdk')]
    const complete = events.filter(e => e.type === 'text_complete')
    expect(complete.map(e => e.text)).toEqual(['查询完毕。\n', '第一段。\n\n第二段。'])
    expect(complete.map(e => e.phase)).toEqual(['intermediate', 'final'])
    expect(complete[0]?.turnId).not.toBe(complete[1]?.turnId)
    expect(events.flatMap(e => e.type === 'text_delta' && e.phase === 'final' ? [e.text] : []).join('')).toBe('第一段。\n\n第二段。')
  }
})
it('streams final paragraphs before finish and bounds withheld marker prefixes', () => {
  const p = create()
  expect(p.push('x'.repeat(10000)).filter(e => e.type === 'text_delta').map(e => e.text).join('').length).toBe(10000)
  const events = p.push(`\n${marker}\n第一段\n\n`)
  expect(events.some(e => e.type === 'text_delta' && e.phase === 'final' && e.text === '第一段\n\n')).toBe(true)
})
it('does not interpret fenced or quoted examples; handles duplicate and missing boundaries', () => {
  const logs: string[] = []; const p = create(logs)
  const pre = `\`\`\`txt\n${marker}\n\`\`\`\n> ${marker}\n`
  const events = [...p.push(`${pre}${marker}\n正文\n${marker}\n结尾`), ...p.finish(true)]
  expect(events.filter(e => e.type === 'text_complete').map(e => e.text)).toEqual([pre, '正文\n结尾'])
  expect(logs).toEqual(['duplicate_boundary'])
  const fallback = create(logs); fallback.push('直接回答')
  expect(fallback.finish(true)[0]).toMatchObject({ text: '直接回答', phase: 'final' })
  expect(logs.at(-1)).toBe('missing_boundary')
})
it('does not produce a blank card and demotes an answer followed by tools', () => {
  const logs: string[] = []; const p = create(logs); p.push(marker)
  expect(p.finish(true)).toEqual([]); expect(logs).toContain('empty_answer')
  const q = create(logs); q.push(`${marker}\n未完成`)
  expect(q.finish(false)[0]).toMatchObject({ text: '未完成', isIntermediate: true })
  expect(logs).toContain('tool_after_boundary')
})
it('treats a terminal marker after the answer as a final reply', () => {
  const logs: string[] = []
  const body = '自检通过。Sankey 图已完成：\n\n```html-preview\n{"src":"/tmp/sankey.html"}\n```\n'
  const p = create(logs)
  const streamed = p.push(`${body}\n${marker}`)
  expect(streamed.some(e => e.type === 'text_complete')).toBe(false)
  const completed = p.finish(true, 'sdk')
  expect(completed.filter(e => e.type === 'text_complete')).toEqual([
    expect.objectContaining({ text: `${body}\n`, phase: 'final', isIntermediate: false, sdkMessageId: 'sdk' }),
  ])
  expect(logs).toContain('trailing_boundary')
})
it('holds whitespace after the marker until answer text arrives', () => {
  const p = create()
  expect(p.push(`进展\n${marker}\n \t`).some(e => e.type === 'text_complete')).toBe(false)
  const events = [...p.push('答案'), ...p.finish(true)]
  expect(events.filter(e => e.type === 'text_complete').map(e => [e.phase, e.text])).toEqual([
    ['intermediate', '进展\n'],
    ['final', ' \t答案'],
  ])

  const continued = create()
  continued.push(`读取中\n${marker}\n \t`)
  expect(continued.finish(false).filter(e => e.type === 'text_complete')).toEqual([
    expect.objectContaining({ text: '读取中\n', isIntermediate: true }),
  ])
})
