import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AnswerBatchGate, collectAnswerBatchParts } from './answer-batch-gate'

describe('answer batch gate (#361)', () => {
  it('collects only tool-call parts from an assistant message', () => {
    expect(collectAnswerBatchParts([
      { type: 'text', text: 'writing the diagram' },
      { type: 'toolCall', id: 'write', name: 'Write' },
      { type: 'tool_use', id: 'submit', name: 'mcp__session__submit_answer' },
    ])).toEqual([
      { type: 'toolCall', id: 'write', name: 'Write' },
      { type: 'tool_use', id: 'submit', name: 'mcp__session__submit_answer' },
    ])
  })

  it('lets submit_answer wait until Write in the same message finishes', async () => {
    const gate = new AnswerBatchGate()
    gate.begin([
      { type: 'toolCall', id: 'write', name: 'Write' },
      { type: 'toolCall', id: 'submit', name: 'submit_answer' },
    ])
    expect(gate.canSettleAnswer).toBe(false)
    let released = false
    const waiting = gate.waitForSiblings().then(() => { released = true })
    await Promise.resolve()
    expect(released).toBe(false)
    gate.markDone('write', 'Write')
    await waiting
    expect(released).toBe(true)
    expect(gate.canSettleAnswer).toBe(true)
  })

  it('does not treat another submit_answer as a sibling that must finish first', async () => {
    const gate = new AnswerBatchGate()
    gate.begin([
      { type: 'toolCall', id: 'a', name: 'submit_answer' },
      { type: 'toolCall', id: 'b', name: 'mcp__session__submit_answer' },
    ])
    await gate.waitForSiblings()
    expect(gate.answerCount).toBe(2)
    expect(gate.canSettleAnswer).toBe(false)
  })

  it('does not accept two answers after a sibling Write settles', async () => {
    const gate = new AnswerBatchGate()
    gate.begin([
      { type: 'toolCall', id: 'write', name: 'Write' },
      { type: 'toolCall', id: 'a', name: 'submit_answer' },
      { type: 'toolCall', id: 'b', name: 'mcp__session__submit_answer' },
    ])
    gate.markDone('write', 'Write')
    await gate.waitForSiblings()
    expect(gate.canSettleAnswer).toBe(false)
  })

  it('resolves immediately when siblings have already settled', async () => {
    const gate = new AnswerBatchGate()
    gate.begin([
      { type: 'toolCall', id: 'write', name: 'Write' },
      { type: 'toolCall', id: 'submit', name: 'submit_answer' },
    ])
    gate.markDone('write', 'Write')
    await gate.waitForSiblings()
    expect(gate.canSettleAnswer).toBe(true)
  })

  it('rejects an in-flight wait when the batch is reset', async () => {
    const gate = new AnswerBatchGate()
    gate.begin([{ type: 'toolCall', id: 'write', name: 'Write' }])
    const waiting = gate.waitForSiblings()
    gate.reset()
    await expect(waiting).rejects.toThrow('interrupted')
    expect(gate.canSettleAnswer).toBe(false)
  })

  it('aborts a waiting submit when the tool signal is cancelled', async () => {
    const gate = new AnswerBatchGate()
    gate.begin([{ type: 'toolCall', id: 'write', name: 'Write' }])
    const controller = new AbortController()
    const waiting = gate.waitForSiblings(controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(waiting).rejects.toThrow('interrupted')
    await expect(gate.waitForSiblings(AbortSignal.abort())).rejects.toThrow('interrupted')
  })

  it('falls back to the old reject path when a sibling has no id', () => {
    const gate = new AnswerBatchGate()
    gate.begin([
      { type: 'toolCall', name: 'Write' },
      { type: 'toolCall', id: 'submit', name: 'submit_answer' },
    ])
    expect(gate.canSettleAnswer).toBe(false)
  })

  it('is wired into the Pi tool wrapper', () => {
    const src = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')
    expect(src).toContain('answerBatchGate.waitForSiblings')
    expect(src).toContain('answerBatchGate.markDone')
    expect(src).toContain('answerBatchGate.begin')
    expect(src).toContain('siblingsSettled')
    expect(src).toContain('answerCalls')
    expect(src).toContain('executingRunId !== answerRunId')
  })
})
