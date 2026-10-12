import { expect, test } from 'bun:test'
import { messageToStored, storedToMessage } from '@craft-agent/core'
import { deriveTurnPhase, groupMessagesByTurn, shouldShowGenericThinkingIndicator } from '@craft-agent/ui/chat/turn-utils'
import { SessionManager, createManagedSession } from '../../../../../../../packages/server-core/src/sessions/SessionManager'
import { processEvent } from '../../processor'
import { createEmptySession } from '../../helpers'
import type { SessionState } from '../../types'

for (const outcome of ['applied', 'cancelled', 'failed']) test(`Office live work chain settles once after parent publication (${outcome})`, () => {
  const internal = new SessionManager() as any
  const parent = createManagedSession({ id: 'parent' }, { id: 'workspace', name: 'Workspace', rootPath: '/tmp/office-flow' } as never, { messagesLoaded: true })
  const answerRunId = 'office-edit-user'
  internal.sessions.set(parent.id, parent)
  internal.officeRevisionRuns.set(parent.id, 'feedback')
  internal.officeRevisionAnswerRuns.set(parent.id, answerRunId)
  internal.officeProgressParents.set('child', parent.id)
  internal.persistSession = () => {}
  let state: SessionState = { session: createEmptySession(parent.id, parent.workspace.id), streaming: null }
  const events: any[] = []
  const send = (event: any) => { events.push(event); state = processEvent(state, event).state }
  internal.sendEvent = send
  send({ type: 'user_message', sessionId: parent.id, status: 'accepted', message: {
    id: 'user', role: 'user', content: '将末句换成更广阔、悲壮的表达', timestamp: 1,
    answerRunId, answerProtocol: 'explicit-v1', answerRoutingVersion: 1,
  } })
  let timestamp = Date.now()
  const forward = (event: any) => internal.forwardOfficeProgress({ sessionId: 'child', turnId: 'pi-turn-1__m0', timestamp: ++timestamp, ...event })
  forward({ type: 'text_delta', phase: 'intermediate', delta: '正在修改' })
  forward({ type: 'text_complete', phase: 'intermediate', isIntermediate: true, text: '正在修改选定段落', messageId: 'progress' })
  for (const index of [1, 2, 3]) {
    forward({ type: 'tool_start', toolName: 'Bash', toolUseId: `call-${index}`, toolInput: { command: 'officecli' } })
    forward({ type: 'tool_result', toolName: 'Bash', toolUseId: `call-${index}`, result: 'done' })
  }
  const beforeFinal = events.length
  forward({ type: 'text_delta', phase: 'unclassified', delta: '已完成并三重核对磁盘真实内容。完整诗文和解释' })
  forward({ type: 'text_complete', phase: 'unclassified', isIntermediate: false, text: '完整诗文和解释', messageId: 'child-final' })
  forward({ type: 'complete' })
  expect(events).toHaveLength(beforeFinal)
  const pending = groupMessagesByTurn(state.session.messages, { isSessionProcessing: true }).filter(turn => turn.type === 'assistant')
  expect(pending).toHaveLength(1)
  expect(pending[0]!.isComplete).toBe(false)
  expect(pending[0]!.response).toBeUndefined()

  const text = outcome === 'applied' ? `已替换选定诗句，并完整保留这段超过四十八字的说明文字；正文和版本列表的短标题分别保存，最后一句也应正常显示。

## 修改结果

- **段落**：已更新
- 已保存成果版本

> Markdown 引用应完整保留。

| 项目 | 结果 |
| --- | --- |
| 校验 | 通过 |` : 'Office 修改已取消。'
  if (outcome === 'failed') send({ type: 'error', sessionId: parent.id, timestamp: ++timestamp, error: 'Office 修改状态读取失败' })
  else send({ type: 'text_complete', sessionId: parent.id, answerRunId, answerProtocol: 'explicit-v1', answerRoutingVersion: 1,
    turnId: answerRunId, messageId: 'answer', timestamp: ++timestamp, text, phase: 'final', isIntermediate: false, answerCommitted: true })
  send({ type: 'complete', sessionId: parent.id, answerRunId, answerRoutingVersion: 1 })
  expect(state.session.isProcessing).toBe(false)
  for (const messages of [state.session.messages, state.session.messages.map(messageToStored).map(storedToMessage)]) {
    const turns = groupMessagesByTurn(messages, { isSessionProcessing: false }).filter(turn => turn.type === 'assistant')
    expect(turns).toHaveLength(1)
    expect(turns[0]!.activities).toHaveLength(4)
    expect(turns[0]!.isComplete).toBe(true)
    expect(shouldShowGenericThinkingIndicator(deriveTurnPhase(turns[0]!), false, turns[0]!.activities)).toBe(false)
    expect(turns[0]!.response?.text).toBe(outcome === 'failed' ? undefined : text)
    expect(messages.some(message => message.content.includes('完整诗文和解释'))).toBe(false)
  }
})
