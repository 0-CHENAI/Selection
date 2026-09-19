import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { completedParagraphs, streamingResponseBody } from '../paragraph-stream'

it('只追加收到的完整段落，不挂载未完成的尾部', () => {
  expect(completedParagraphs('第一段', true)).toBe('')
  expect(completedParagraphs('第一段\n\n第二', true)).toBe('第一段\n\n')
  expect(completedParagraphs('第一段\n\n第二段\n\n第三', true)).toBe('第一段\n\n第二段\n\n')
  expect(completedParagraphs('第一段\n\n第二段', false)).toBe('第一段\n\n第二段')
})

it('代码块里的空行不会成为段落分界', () => {
  const prefix = '说明\n\n'
  const code = '```ts\nconst x = 1\n\n'
  expect(completedParagraphs(prefix + code, true)).toBe(prefix)
  expect(completedParagraphs(prefix + code + '```\n\n尾部', true)).toBe(prefix + code + '```\n\n')
})

it('列表和引用内部的空行不拆开同一块', () => {
  expect(completedParagraphs('介绍\n\n- 第一项\n\n- 第二项', true)).toBe('介绍\n\n')
  expect(completedParagraphs('介绍\n\n> 第一段\n>\n> 第二段\n\n', true)).toBe('介绍\n\n')
  expect(completedParagraphs('- 第一项\n\n- 第二项\n\n下一段', true)).toBe('- 第一项\n\n- 第二项\n\n')
})

it('keeps the white response frame mounted and does not tween its height', () => {
  const src = readFileSync(join(import.meta.dir, '../TurnCard.tsx'), 'utf8')
  const grow = src.slice(src.indexOf('function GrowingResponse'), src.indexOf('function ActivityRow'))
  expect(grow).not.toContain('animate={{ height')
  expect(src).not.toContain('hasVisibleResponse && !isBuffering')
  expect(src).not.toContain('if (isStreaming && !bodyText.trim())')
})

it('publishes complete blocks and lets prose tails grow, holding only unsafe tails', () => {
  expect(streamingResponseBody('第一段', true)).toBe('第一段')
  expect(streamingResponseBody('第一段\n\n第二', true)).toBe('第一段\n\n第二')
  expect(streamingResponseBody('介绍\n\n- 第一项', true)).toBe('介绍\n\n')
  expect(streamingResponseBody('说明\n\n```ts\nconst x = 1\n', true)).toBe('说明\n\n')
  expect(streamingResponseBody('普通一行\n---', true)).toBe('普通一行\n')
  expect(streamingResponseBody('1', true)).toBe('')
  expect(streamingResponseBody('2026 年发布', true)).toBe('2026 年发布')
  expect(streamingResponseBody('第一段\n\n第二段', false)).toBe('第一段\n\n第二段')
})

it('reserves the desktop action row while the response is still streaming', () => {
  const src = readFileSync(join(import.meta.dir, '../TurnCard.tsx'), 'utf8')
  expect(src).toContain('reserveDesktopFooter')
  expect(src).toContain('!actionsVisible && "invisible pointer-events-none"')
})

 it('holds tables without outer pipes, parenthesized lists and indented code', () => {
  for (const block of ['名称 | 数值\n--- | ---\nA | 1\n', '1) 第一项\n\n2) 第二项', '    code\n\n    more']) {
    expect(streamingResponseBody('前言\n\n' + block, false)).toBe('前言\n\n' + block)
  }
  // A table header row publishes as plain prose until its delimiter line
  // appears; the delimiter itself and everything below it stay held.
  expect(streamingResponseBody('前言\n\n名称 | 数值\n--- | ---\nA | 1\n', true)).toBe('前言\n\n名称 | 数值\n')
  expect(streamingResponseBody('前言\n\n1) 第一项\n\n2) 第二项', true)).toBe('前言\n\n')
  expect(streamingResponseBody('前言\n\n    code\n\n    more', true)).toBe('前言\n\n')
 })
 it('never rewrites a committed prefix across transport chunks', () => {
  const text = '前言\n\n名称 | 数值\n--- | ---\nA | 1\n\n结束。'
  let previous = ''
  for (let n = 0; n <= text.length; n++) {
    const visible = streamingResponseBody(text.slice(0, n), true)
    expect(visible.startsWith(previous)).toBe(true)
    previous = visible
  }
 })
