import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { taskAssignmentSummary, withTaskMessagePresentation } from '../task-message-presentation'
import { groupMessagesByTurn } from '../turn-utils'

const assignment = 'Canonical execution identity: slug="task", runId="run-123", nodeId="risk".\nOriginal user goal: 比较成本与风险\nAcceptance criteria: 保留资料限制\nResearch role: researcher. Frozen research criteria and records: {"sourceVersion":"abc123"}'
const verification = 'The task "成本与风险" has finished running.\nTask slug: task; runId: run-123\nNode outputs:\n{"claims":[]}\nCall submit_task_verdict with result pass or fail.'
const user = (content: string): Message => ({ id: 'user', role: 'user', timestamp: 1, content })
const legacyResearchAssignment = `Apply these skills: [skill:deep-research]\n\nResearch role: researcher. Frozen research criteria and records (read necessary original source snapshot paths independently): ${JSON.stringify({
  line: { question: '比较两年成本与风险', premises: ['只分析两年期间'] },
  dimensions: [{ requirement: '成本必须可定位原始资料' }],
  sources: [{ ref: '已冻结的成本资料', hash: 'internal-hash', snapshotPath: '/internal/source.txt' }],
  claims: [{ id: 'cost', version: 1 }],
})}\nSubmit values.research using the native Skill contract.\nUser constraints for every node: ["不得修改文件","只分析两年期间"]\nConfirmed plan decisions: ["submit_orchestration_patch with depends_on=[cost]"]\n\n独立核对原始成本资料。保留资料限制。Submit values.research.`

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

  it('projects the real legacy skill-prefixed research format into readable inputs and preserves the answer', () => {
    const message = user(legacyResearchAssignment)
    const presented = withTaskMessagePresentation(message, { taskSlug: 'task', nodeId: 'cost', title: 'cost' })
    expect(presented.taskContext).toEqual({
      kind: 'assignment', description: '比较两年成本与风险', instruction: '独立核对原始成本资料。保留资料限制。Submit values.research.',
      briefing: { requirements: ['成本必须可定位原始资料'], sources: ['已冻结的成本资料'], limits: ['只分析两年期间', '不得修改文件'] },
    })
    expect(JSON.stringify(presented.taskContext)).not.toMatch(/internal-hash|snapshotPath|depends_on/)
    expect(taskAssignmentSummary(presented.taskContext)).toBe('独立核对原始成本资料。 保留资料限制。')
    const answer = { ...user('成本已核对，风险资料存在缺口。'), id: 'answer', role: 'assistant' as const }
    const turns = groupMessagesByTurn([presented, answer], { isSessionProcessing: false })
    expect(turns).toHaveLength(1)
    expect(turns[0]?.type === 'assistant' && turns[0].response?.text).toBe(answer.content)
    expect(message).not.toHaveProperty('taskContext')
    expect(presented.content).toBe(legacyResearchAssignment)
  })

  it('enriches current assignment metadata without changing its host-provided title, goal or run identity', () => {
    const message = { ...user(legacyResearchAssignment), taskContext: { kind: 'assignment' as const, runId: 'run', title: '核对资料', description: '原目标' } }
    expect(withTaskMessagePresentation(message, { taskSlug: 'task', nodeId: 'cost' }).taskContext).toMatchObject({
      ...message.taskContext, briefing: { sources: ['已冻结的成本资料'] },
    })
    expect(message.taskContext).not.toHaveProperty('briefing')
  })

  it('shows the specific legacy parent assignment rather than the global goal or prior actor outputs', () => {
    const instruction = '独立 Read 冻结原文，对 cost@1 做精确版本审查。实际检查100000元是否被原文支持。发现矛盾时记录 wrong-cost issue,claimRef cost@1,disposition=defer。'
    const message = user(legacyResearchAssignment.replace('独立核对原始成本资料。保留资料限制。Submit values.research.', instruction)
      + '\n\nConfirmed prior actor task results (new execution context): {"nodeId":"internal-id"}')
    const presented = withTaskMessagePresentation(message, { taskSlug: 'task', nodeId: 'review' })
    expect(presented.taskContext?.instruction).toBe(instruction)
    expect(taskAssignmentSummary(presented.taskContext)).toBe('独立读取冻结原文，对 cost@1 做精确版本审查。 实际检查100000元是否被原文支持。')
    expect(taskAssignmentSummary(presented.taskContext)).not.toMatch(/比较两年|claimRef|internal-id|disposition/)
    expect(presented.content).toBe(message.content)
  })

  it('skips a legacy retry failure and code blocks while preserving error injection and real task requirements', () => {
    expect(taskAssignmentSummary({ kind: 'assignment', instruction: 'completed without submit_task_output\n\n独立 Read 冻结原文第5行。不要据此作总体推荐。' })).toBe('独立读取冻结原文第5行。 不要据此作总体推荐。')
    expect(taskAssignmentSummary({ kind: 'assignment', instruction: '```json\n{"claim":"internal"}\n```\n这是合成 QA 错误注入节点。提交错误金额供独立审查发现。' })).toBe('这是合成 QA 错误注入节点。 提交错误金额供独立审查发现。')
    const message = user(legacyResearchAssignment.replace('独立核对原始成本资料。保留资料限制。Submit values.research.', 'Research output: Error: Evidence identity e-risk already exists; use a new evidence version identity\n\n独立 Read 冻结原文第5行。不要据此作总体推荐。'))
    expect(taskAssignmentSummary(withTaskMessagePresentation(message, { taskSlug: 'task', nodeId: 'risk' }).taskContext)).toBe('独立读取冻结原文第5行。 不要据此作总体推荐。')
  })

  it('prefers persisted parent instructions and omits data contracts without changing the source', () => {
    const instruction = '[skill:deep-research]\n独立读取成本资料。提交 claims 中同一 claim id=cost,version=2，文本准确为“成本为 1,000,000 元”，dimensionIds=[cost]。不得修改旧报告。'
    const context = { kind: 'assignment' as const, title: '核对成本', instruction }
    const presented = withTaskMessagePresentation({ ...user(legacyResearchAssignment), taskContext: context }, { taskSlug: 'task', nodeId: 'cost' })
    expect(presented.taskContext?.instruction).toBe(instruction)
    expect(taskAssignmentSummary(presented.taskContext)).toBe('独立读取成本资料。 文本准确为“成本为 1,000,000 元”。')
    expect(context.instruction).toBe(instruction)
    expect(taskAssignmentSummary({ kind: 'assignment', description: '只提供总体目标' })).toBeUndefined()
    expect(taskAssignmentSummary({ kind: 'coordination', instruction: '不属于子代理交办' })).toBeUndefined()
    expect(taskAssignmentSummary({ kind: 'assignment', title: '核对资料', instruction: 'Submit values.research using the native Skill contract.' })).toBe('核对资料')
  })

  it('handles damaged research JSON without displaying protocol and leaves skill-only user messages alone', () => {
    const damaged = user('Apply these skills: [skill:deep-research]\n\nResearch role: researcher. Frozen research criteria and records: {broken-json}')
    expect(withTaskMessagePresentation(damaged, { taskSlug: 'task', nodeId: 'cost' }).taskContext).toEqual({ kind: 'assignment' })
    for (const message of [user('Apply these skills: [skill:deep-research]\n\n这是用户要求'), user(legacyResearchAssignment)]) {
      expect(withTaskMessagePresentation(message, {})).toBe(message)
    }
    const ordinary = user('Apply these skills: [skill:deep-research]\n\n这是用户要求')
    expect(withTaskMessagePresentation(ordinary, { taskSlug: 'task', nodeId: 'cost' })).toBe(ordinary)
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

describe('root orchestration work chain', () => {
  const checkpoint = (id: string, timestamp: number, kind: 'coordination' | 'verification' = 'coordination', runId = 'run-123'): Message => ({
    ...user('host protocol'), id, timestamp, hidden: true, answerRunId: `answer-${id}`,
    taskContext: { kind, runId },
  })
  const reply = (id: string, timestamp: number, content = '已消费结果，等待其他子代理。', answerRunId?: string): Message => ({ id, role: 'assistant', timestamp, content, answerRunId })
  const committedReply = (id: string, timestamp: number, content: string, checkpointId: string): Message => ({
    ...reply(id, timestamp, content, `answer-${checkpointId}`), answerProtocol: 'explicit-v1', answerCommitted: true,
  })
  const receipt = (id: string, timestamp: number, status: string, toolName = 'submit_orchestration_decision', runId = 'run-123'): Message => ({
    id, role: 'tool', timestamp, toolName: `mcp__session__${toolName}`, toolStatus: 'completed',
    content: '', toolResult: JSON.stringify({ status }), toolInput: { runId },
  })
  const options = { isTaskOrchestrationRoot: true, isSessionProcessing: false }

  it('collects hidden checkpoints and their replies across answer runs, even between worker callbacks', () => {
    const messages = [checkpoint('cp-1', 1), receipt('continue', 2, 'running'), reply('ack-1', 3, undefined, 'answer-cp-1'),
      checkpoint('cp-2', 4), receipt('patch', 5, 'running'), reply('ack-2', 6, '下一步核验修订稿。', 'answer-cp-2')]
    const frozen = JSON.stringify(messages)
    for (const running of [true, false]) {
      const turns = groupMessagesByTurn(messages, { ...options, isTaskOrchestrationRunning: running })
      expect(turns).toHaveLength(1)
      if (turns[0]?.type !== 'assistant') throw new Error('expected work chain')
      expect(turns[0].response).toBeUndefined()
      expect(turns[0].taskRunId).toBe('run-123')
      expect(turns[0].activities.filter(item => item.type === 'intermediate').map(item => item.content)).toEqual([
        '已消费结果，等待其他子代理。', '下一步核验修订稿。',
      ])
      expect(turns[0].isComplete).toBe(!running)
      expect(turns[0].turnId).toBe('answer-answer-cp-1')
    }
    expect(JSON.stringify(messages)).toBe(frozen)
  })

  it('keeps streaming coordinator text inside the closed chain before any receipt', () => {
    const turns = groupMessagesByTurn([checkpoint('cp', 1), { ...reply('draft', 2), isStreaming: true }], {
      ...options, isSessionProcessing: true, isTaskOrchestrationRunning: true,
    })
    expect(turns[0]?.type === 'assistant' && turns[0].response).toBeUndefined()
    expect(turns[0]?.type === 'assistant' && turns[0].isStreaming).toBe(true)
  })

  it('shows the consolidated report only after accepted verification, despite lagging running metadata', () => {
    const turns = groupMessagesByTurn([checkpoint('cp', 1), receipt('continue', 2, 'running'), reply('ack', 3),
      checkpoint('verify', 4, 'verification'), receipt('verdict', 5, 'completed', 'submit_task_verdict'), committedReply('report', 6, '最终报告：成本已复核，资料限制已保留。', 'verify')],
    { ...options, isTaskOrchestrationRunning: true })
    expect(turns).toHaveLength(1)
    if (turns[0]?.type !== 'assistant') throw new Error('expected report')
    expect(turns[0].response?.text).toBe('最终报告：成本已复核，资料限制已保留。')
    expect(turns[0].isComplete).toBe(true)
  })

  it('keeps repair steps folded and refuses a rejected or foreign verdict as completion', () => {
    const messages = [checkpoint('verify', 1, 'verification'),
      { ...receipt('rejected', 2, 'completed', 'submit_task_verdict'), isError: true }, reply('premature', 3, '尚不能验收。'),
      checkpoint('repair', 4), receipt('foreign', 5, 'completed', 'submit_task_verdict', 'different-run'), reply('ack', 6)]
    const turns = groupMessagesByTurn(messages, options)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.type === 'assistant' && turns[0].response).toBeUndefined()
    expect(turns[0]?.type === 'assistant' && turns[0].activities.some(activity => activity.status === 'error')).toBe(true)
  })

  it('preserves pause/failure reports, human replies and preceding completed runs', () => {
    const turns = groupMessagesByTurn([checkpoint('cp', 1), receipt('pause', 2, 'paused'), committedReply('blocked', 3, '已暂停，请确认范围。', 'cp'),
      { ...user('只确认恢复标记，先不要继续。'), id: 'human', timestamp: 4 }, reply('human-reply', 5, '已收到，继续等待。'),
      checkpoint('resume', 6), receipt('failed', 7, 'failed'), committedReply('failure', 8, '请重试失败节点。', 'resume'),
      checkpoint('new-run', 9, 'coordination', 'run-456'), reply('next', 10)], options)
    expect(turns).toHaveLength(5)
    expect(turns[0]?.type === 'assistant' && turns[0].response?.text).toBe('已暂停，请确认范围。')
    expect(turns[1]?.type).toBe('user')
    expect(turns[2]?.type === 'assistant' && turns[2].response?.text).toBe('已收到，继续等待。')
    expect(turns[3]?.type === 'assistant' && turns[3].response?.text).toBe('请重试失败节点。')
    expect(turns[4]?.type === 'assistant' && turns[4].taskRunId).toBe('run-456')
  })

  it('keeps only the current chain running after a human boundary', () => {
    const turns = groupMessagesByTurn([checkpoint('old', 1), reply('old-ack', 2),
      { ...user('开始下一阶段。'), id: 'human', timestamp: 3 }, checkpoint('current', 4), reply('ack', 5)],
    { ...options, isTaskOrchestrationRunning: true })
    expect(turns[0]?.type === 'assistant' && turns[0].isComplete).toBe(true)
    expect(turns[2]?.type === 'assistant' && turns[2].isComplete).toBe(false)
  })

  it('recognizes historical hidden root checkpoints while leaving ordinary and worker chat unchanged', () => {
    const legacy = { ...user('Conductor checkpoint (new-result). Task slug=task; runId=run-123. Call submit_orchestration_decision with action continue.'), hidden: true }
    const projected = withTaskMessagePresentation(legacy, { taskSlug: 'task' })
    expect(projected.taskContext?.kind).toBe('coordination')
    const messages = [projected, reply('ack', 2)]
    expect(groupMessagesByTurn(messages, options)[0]?.type === 'assistant' && groupMessagesByTurn(messages, options)[0]).toHaveProperty('taskRunId', 'run-123')
    expect(groupMessagesByTurn(messages, { isSessionProcessing: false })[0]?.type === 'assistant' && groupMessagesByTurn(messages, { isSessionProcessing: false })[0]).toHaveProperty('response.text', '已消费结果，等待其他子代理。')
    expect(withTaskMessagePresentation(legacy, { taskSlug: 'task', nodeId: 'worker' })).toBe(legacy)
  })
})
