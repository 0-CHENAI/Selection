import { describe, expect, it } from 'bun:test'
import { ThinkLeakBuffer, splitThinkDelimiter } from '../think-delimiter.ts'

describe('splitThinkDelimiter', () => {
  it('splits a bare close delimiter and keeps the answer', () => {
    expect(splitThinkDelimiter('先看结构\n</think>\n\n## 结论\n\n可以开始。')).toEqual({
      thinking: '先看结构',
      answer: '## 结论\n\n可以开始。',
    })
  })

  it('strips a wrapped think block', () => {
    expect(splitThinkDelimiter('<think>内部</think>\n正文')).toEqual({
      thinking: '内部',
      answer: '正文',
    })
  })

  it('leaves a delimiter inside a fence in the answer', () => {
    const text = '```\n</think>\n```\n\n正文'
    expect(splitThinkDelimiter(text)).toBeNull()
  })

  it('returns null when the body has no delimiter', () => {
    expect(splitThinkDelimiter('普通回答')).toBeNull()
  })
})

describe('ThinkLeakBuffer', () => {
  it('releases ordinary text immediately', () => {
    const buffer = new ThinkLeakBuffer()
    expect(buffer.push('Hello')).toEqual([{ kind: 'text', text: 'Hello' }])
    expect(buffer.push(' world')).toEqual([{ kind: 'text', text: ' world' }])
  })

  it('routes a leading think block away from the answer', () => {
    const buffer = new ThinkLeakBuffer()
    expect(buffer.push('<thi')).toEqual([])
    const opened = buffer.push('nk>先想</think>好')
    expect(opened).toEqual([
      { kind: 'thinking', text: '先想' },
      { kind: 'thinking', text: '', done: true },
      { kind: 'text', text: '好' },
    ])
  })

  it('splits a bare close tag that arrives before any text is released', () => {
    const buffer = new ThinkLeakBuffer()
    expect(buffer.push('推理</think>\n答案')).toEqual([
      { kind: 'thinking', text: '推理' },
      { kind: 'thinking', text: '', done: true },
      { kind: 'text', text: '答案' },
    ])
  })
})
