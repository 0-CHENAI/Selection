import { expect, test } from 'bun:test'
import { messageToStored, storedToMessage } from '@craft-agent/core'
import { groupMessagesByTurn } from '@craft-agent/ui/chat/turn-utils'
import { processEvent } from '../../processor'
import { missingCommittedAnswerRun, recoverCommittedAnswer } from '../../answer-recovery'
import type { SessionState, AgentEvent } from '../../types'

const initial = (): SessionState => ({ session: {
  id: 's', workspaceId: 'w', workspaceName: 'Test', lastMessageAt: 1, isProcessing: true,
  messages: [{ id: 'u', role: 'user', content: '问题', timestamp: 1 }],
}, streaming: null })
const send = (state: SessionState, event: AgentEvent) => processEvent(state, event).state
const preview = { type: 'answer_preview', sessionId: 's', userMessageId: 'u', answerRunId: 'r', answerRoutingVersion: 1, toolCallId: 't', text: '预览' } as const
const commit = { type: 'text_complete', sessionId: 's', answerProtocol: 'explicit-v1', answerRunId: 'r', answerRoutingVersion: 1, answerCommitted: true, answerSalvaged: true, messageId: 'answer', timestamp: 10, text: '完整正文' } as const

test('live, replay and exported answers preserve body and salvage provenance', () => {
  for (const text of ['好', '请提供文件。', '无法完成：工具失败。', '# 解释\n提交答案不会改变正文。', '```ts\nconst a = 1\n```', '| A | B |\n|---|---|\n| 1 | 2 |', '> 引用\n\n[文件](D:/成果/报告.html)', '长文段落\n\n'.repeat(1000)]) {
    const event = { ...commit, text }
    let state = send(send(initial(), preview), event)
    state = send(state, event)
    expect(state.session.messages.filter(m => m.answerCommitted)).toHaveLength(1)
    expect(state.session.messages.some(m => m.answerPreview)).toBe(false)
    const stored = JSON.parse(JSON.stringify(state.session.messages.map(messageToStored))).map(storedToMessage)
    for (const messages of [state.session.messages, stored]) {
      const turns = groupMessagesByTurn(messages, { isSessionProcessing: false }).filter(t => t.type === 'assistant')
      expect(turns).toHaveLength(1)
      expect(turns[0]!.response).toMatchObject({ text, answerSalvaged: true })
    }
  }
})

test('missing event refresh uses only a persisted answer and cannot overwrite a newer run', () => {
  const running = send(initial(), preview)
  const stopped = send(running, { type: 'complete', sessionId: 's' }).session
  const loaded = send(running, commit).session
  expect(missingCommittedAnswerRun(stopped)).toBe('r')
  expect(recoverCommittedAnswer(stopped, stopped, 'r')).toBe(stopped)
  const restored = recoverCommittedAnswer(stopped, loaded, 'r')
  expect(restored.messages.filter(m => m.answerCommitted)).toHaveLength(1)
  expect(recoverCommittedAnswer(restored, loaded, 'r')).toBe(restored)
  expect(recoverCommittedAnswer(running.session, loaded, 'r')).toBe(running.session)
  const newer = { ...stopped, messages: [...stopped.messages, { id: 'new-user', role: 'user' as const, content: '新问题', timestamp: 20 }] }
  expect(recoverCommittedAnswer(newer, loaded, 'r')).toBe(newer)
})

test('artifact snapshot badges retain their delivered identity through live events, duplicate delivery and reload', () => {
  const artifactVersions = [{ path: 'report.html', versionId: 'abcdef01-1111-4444-8888-111111111111', ordinal: 2 }]
  const event = { ...commit, text: '[报告](report.html)', artifactVersions }
  let state = send(send(initial(), preview), event)
  state = send(state, event)
  const reloaded = JSON.parse(JSON.stringify(state.session.messages.map(messageToStored))).map(storedToMessage)
  for (const messages of [state.session.messages, reloaded]) {
    const turns = groupMessagesByTurn(messages, { isSessionProcessing: false }).filter(turn => turn.type === 'assistant')
    expect(turns).toHaveLength(1)
    expect(turns[0]!.response?.artifactVersions).toEqual(artifactVersions)
  }
})

test('tool result inherits metadata when a compatibility sender omits it', () => {
  let state = send(initial(), { type: 'tool_start', sessionId: 's', toolUseId: 't', toolName: 'submit_answer', toolPurpose: 'work', answerRoutingVersion: 1, answerRunId: 'r' })
  state = send(state, { type: 'tool_result', sessionId: 's', toolUseId: 't', toolName: 'submit_answer', result: 'result' })
  expect(state.session.messages.find(m => m.toolUseId === 't')).toMatchObject({ toolPurpose: 'work', answerRoutingVersion: 1, answerRunId: 'r' })
})


test('completion metadata can recover when all delivery stream events were lost', () => {
  const stopped = send(initial(), { type: 'complete', sessionId: 's', answerRunId: 'r', answerRoutingVersion: 1 }).session
  const loaded = send(initial(), commit).session
  expect(missingCommittedAnswerRun(stopped)).toBe('r')
  expect(recoverCommittedAnswer(stopped, loaded, 'r').messages.filter(m => m.answerCommitted)).toHaveLength(1)
})


test('refresh identifies a new user turn after history and ignores old completion metadata', () => {
  const base = initial()
  base.session.messages.unshift({ id: 'old', role: 'user', content: '历史', timestamp: 0, answerRoutingVersion: 1, answerRunId: 'old-run' })
  const stopped = send(base, { type: 'complete', sessionId: 's', answerRunId: 'r', answerRoutingVersion: 1 }).session
  expect(missingCommittedAnswerRun(stopped)).toBe('r')
  const stale = send(base, { type: 'complete', sessionId: 's', answerRunId: 'old-run', answerRoutingVersion: 1 }).session
  expect(missingCommittedAnswerRun(stale)).toBeUndefined()
})
