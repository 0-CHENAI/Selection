import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { withTaskMessagePresentation } from '../task-message-presentation'
import { groupMessagesByTurn } from '../turn-utils'

const assignment = 'Canonical execution identity: slug="task", runId="run-123", nodeId="risk".\nOriginal user goal: 比较成本与风险\nAcceptance criteria: 保留资料限制\nResearch role: researcher. Frozen research criteria and records: {"sourceVersion":"abc123"}'
const verification = 'The task "成本与风险" has finished running.\nTask slug: task; runId: run-123\nNode outputs:\n{"claims":[]}\nCall submit_task_verdict with result pass or fail.'
const user = (content: string): Message => ({ id: 'user', role: 'user', timestamp: 1, content })

describe('task message presentation', () => {
  it('makes an owned historical assignment readable without mutating its protocol or routing', () => {
    const message = { ...user(assignment), answerRunId: 'answer-run' }
    const presented = withTaskMessagePresentation(message, { taskSlug: 'task', nodeId: 'risk', title: '分析风险缺口' })
    expect(presented.taskContext).toEqual({ kind: 'assignment', title: '分析风险缺口', description: '比较成本与风险' })
    expect(presented.content).toBe(assignment)
    expect(presented.answerRunId).toBe('answer-run')
    expect(message).not.toHaveProperty('taskContext')
  })

  it('recognizes result review and coordinator checkpoints on historical roots', () => {
    expect(withTaskMessagePresentation(user(verification), { taskSlug: 'task' }).taskContext).toEqual({ kind: 'verification' })
    expect(withTaskMessagePresentation(user('Conductor checkpoint (batch-complete). Call submit_orchestration_decision with action continue.'), { taskSlug: 'task' }).taskContext).toEqual({ kind: 'coordination' })
  })

  it('preserves ordinary JSON, quoted protocols outside tasks, partial matches and assistant answers', () => {
    for (const [message, context] of [
      [user('{"claims":[{"text":"方案 A 为 100 万元"}]}'), { taskSlug: 'task', nodeId: 'risk' }],
      [user(assignment), {}],
      [user('Canonical execution identity: slug="task"'), { taskSlug: 'task', nodeId: 'risk' }],
      [{ ...user(assignment), role: 'assistant' }, { taskSlug: 'task', nodeId: 'risk' }],
    ] as [Message, { taskSlug?: string; nodeId?: string }][]) {
      expect(withTaskMessagePresentation(message, context)).toBe(message)
    }
  })

  it('leaves hidden nudges and explicit new presentation metadata intact', () => {
    for (const message of [{ ...user(verification), hidden: true }, { ...user(assignment), taskContext: { kind: 'assignment' as const, title: '读取资料' } }]) {
      expect(withTaskMessagePresentation(message, { taskSlug: 'task', nodeId: 'risk' })).toBe(message)
    }
    expect(withTaskMessagePresentation(user(assignment), { taskSlug: 'task', nodeId: 'risk', title: 'risk' }).taskContext).not.toHaveProperty('title')
  })

  it('keeps protocols in collapsed execution steps alongside tools, never as user bubbles or answers', () => {
    const context = withTaskMessagePresentation(user(assignment), { taskSlug: 'task', nodeId: 'risk', title: '分析风险' })
    const tool: Message = { id: 'read', role: 'tool', toolName: 'Read', toolStatus: 'completed', content: '原始资料', timestamp: 2 }
    const answer: Message = { id: 'answer', role: 'assistant', content: '风险资料尚有缺口，无法做出完整判断。', timestamp: 3 }
    const turns = groupMessagesByTurn([context, tool, answer], { isSessionProcessing: false })
    expect(turns).toHaveLength(1)
    expect(turns[0]?.type).toBe('assistant')
    if (turns[0]?.type !== 'assistant') throw new Error('expected execution turn')
    expect(turns[0].activities[0]).toMatchObject({ type: 'task-context', taskContext: context.taskContext, content: assignment })
    expect(turns[0].activities[1]?.toolName).toBe('Read')
    expect(turns[0].response?.text).toBe(answer.content)
    const unfinished = groupMessagesByTurn([context], { isSessionProcessing: false })
    expect(unfinished[0]?.type === 'assistant' && unfinished[0].response).toBeUndefined()
  })

  it('does not demote the preceding report when a later internal review starts a new turn', () => {
    const review = withTaskMessagePresentation({ ...user(verification), id: 'review', timestamp: 3 }, { taskSlug: 'task' })
    const turns = groupMessagesByTurn([
      user('比较成本与风险'), { id: 'draft', role: 'assistant', content: '已有报告', timestamp: 2 },
      review, { id: 'final', role: 'assistant', content: '复核后的结论', timestamp: 4 },
    ], { isSessionProcessing: false })
    expect(turns).toHaveLength(3)
    expect(turns[1]?.type === 'assistant' && turns[1].response?.text).toBe('已有报告')
    expect(turns[2]?.type === 'assistant' && turns[2].response?.text).toBe('复核后的结论')
  })
})
