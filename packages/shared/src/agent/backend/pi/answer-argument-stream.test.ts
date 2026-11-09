import { describe, expect, it } from 'bun:test'
import { AnswerArgumentStream } from '../../../answer-argument-stream'

describe('answer argument streaming (#350)', () => {
  it('decodes every split boundary without exposing JSON or incomplete escapes', () => {
    const markdown = '# 答案\n\n| a | b |\n| - | - |\n| "hi" | \\path |\n😀'
    const input = JSON.stringify({ markdown }).replace('😀', '\\ud83d\\ude00')
    for (let split = 1; split < input.length; split++) {
      const stream = new AnswerArgumentStream()
      const prefix = stream.push(input.slice(0, split))
      expect(markdown.startsWith(prefix)).toBe(true)
      expect(stream.push(input.slice(split))).toBe(markdown)
    }
  })
  it('skips only known leading metadata, including escaped quotes', () => {
    const stream = new AnswerArgumentStream()
    const input = JSON.stringify({ _intent: 'say "hello"', _displayName: 'Answer', markdown: '# 正文\n内容' })
    let text = ''
    for (const ch of input) text = stream.push(ch)
    expect(text).toBe('# 正文\n内容')
  })
  it('handles one-character deltas and rejects invalid escapes', () => {
    const stream = new AnswerArgumentStream()
    let text = ''
    for (const ch of '{"markdown":"a\\n\\t\\u4e2d"}') text = stream.push(ch)
    expect(text).toBe('a\n\t中')
    expect(new AnswerArgumentStream().push('{"markdown":"bad\\q')).toBe('')
    expect(new AnswerArgumentStream().push('{"other":"not an answer"}')).toBe('')
  })
})
