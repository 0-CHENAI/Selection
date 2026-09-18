import { AnswerBoundary } from '../../../../../../../packages/shared/src/agent/backend/pi/answer-boundary'
import { describe, expect, it } from 'bun:test'
import { deriveTurnPhase, groupMessagesByTurn } from '@craft-agent/ui/chat/turn-utils'
import { completedParagraphs } from '../../../../../../../packages/ui/src/components/chat/paragraph-stream'
import { handleTextComplete, handleTextDelta } from '../text'
import { handleToolStart } from '../tool'
import { handleComplete, handleError, handleInterrupted } from '../session'
import type { SessionState } from '../../types'

function state(): SessionState {
  return {
    session: {
      id: 'session-1',
      workspaceId: 'workspace-1',
      messages: [{ id: 'user-1', role: 'user', content: '检查项目', timestamp: 1 }],
      isProcessing: true,
      lastMessageAt: 1,
    } as SessionState['session'],
    streaming: null,
  }
}

function assistantTurn(current: SessionState, isSessionProcessing = true) {
  const turn = groupMessagesByTurn(current.session.messages, { isSessionProcessing })
    .findLast((item) => item.type === 'assistant')
  if (!turn || turn.type !== 'assistant') throw new Error('expected assistant turn')
  return turn
}

describe('issue #87 text stream phases', () => {
  it('moves a native streaming draft into the work chain when completion identifies commentary', () => {
    const draft = handleTextDelta(state(), {
      type: 'text_delta', sessionId: 'session-1', delta: '先查询数据库。',
      phase: 'unclassified', turnId: 'native-draft',
    })
    expect(assistantTurn(draft).response).toMatchObject({ text: '先查询数据库。', isStreaming: true })
    const commentary = handleTextComplete(draft, {
      type: 'text_complete', sessionId: 'session-1', text: '先查询数据库。',
      isIntermediate: true, turnId: 'native-draft', messageId: 'commentary',
    })
    expect(assistantTurn(commentary).response).toBeUndefined()
    expect(assistantTurn(commentary).activities[0]?.content).toBe('先查询数据库。')
  })

  it('shows native unclassified text while the model is still streaming', () => {
    const pending = handleTextDelta(state(), {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '我先检查配置。',
      phase: 'unclassified',
      turnId: 'message-1',
    })
    const pendingTurn = assistantTurn(pending)
    expect(pendingTurn.response).toMatchObject({ text: '我先检查配置。', isStreaming: true })

    const final = handleTextComplete(pending, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '配置检查完成。',
      isIntermediate: false,
      turnId: 'message-1',
      messageId: 'answer-1',
    })
    const finalTurn = assistantTurn(final)
    expect(finalTurn.activities).toEqual([])
    expect(finalTurn.response).toMatchObject({
      text: '配置检查完成。',
      isStreaming: false,
      messageId: 'answer-1',
    })
  })

  it('shows final deltas before the complete response arrives', () => {
    const intermediate = handleTextDelta(state(), {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '正在核对测试。',
      phase: 'intermediate',
      turnId: 'message-1',
    })
    const withTool = handleToolStart(intermediate, {
      type: 'tool_start',
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      toolInput: { command: 'bun test' },
      turnId: 'tool-turn',
    })
    const finalStreaming = handleTextDelta(withTool, {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '测试全部通过',
      phase: 'final',
      turnId: 'message-2',
    })
    const turn = assistantTurn(finalStreaming)

    expect(turn.activities.map((activity) => activity.type)).toEqual(['intermediate', 'tool'])
    expect(turn.response).toMatchObject({ text: '测试全部通过', isStreaming: true })
    expect(finalStreaming.streaming).toMatchObject({
      content: '测试全部通过',
      phase: 'final',
      turnId: 'message-2',
    })

    const completed = handleTextComplete(finalStreaming, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '测试全部通过。',
      isIntermediate: false,
      turnId: 'message-2',
      timestamp: 10,
      messageId: 'answer-1',
    })
    const completedTurn = assistantTurn(completed)
    const completedMessage = completed.session.messages.find(message => message.id === 'answer-1')
    expect(completedTurn.response).toMatchObject({
      text: '测试全部通过。',
      isStreaming: false,
      completedRevealStartTime: completedMessage?.timestamp,
      messageId: 'answer-1',
    })
  })

  it('uses the local completion time for a legacy final without a timestamp', () => {
    const pending = handleTextDelta(state(), {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '旧协议最终正文',
      turnId: 'legacy-final',
    })
    const beforeComplete = Date.now()
    const completed = handleTextComplete(pending, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '旧协议最终正文。',
      isIntermediate: false,
      turnId: 'legacy-final',
      messageId: 'legacy-answer',
    })
    const turn = assistantTurn(completed)

    expect(turn.response?.completedRevealStartTime).toBeGreaterThanOrEqual(beforeComplete)
  })

  it('keeps a streamed final body correlated when commentary completes first', () => {
    const finalStreaming = handleTextDelta(state(), {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '最终结论。',
      phase: 'final',
      turnId: 'final-segment',
    })
    const commentaryComplete = handleTextComplete(finalStreaming, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '我先检查了文件。',
      isIntermediate: true,
      turnId: 'commentary-segment',
      messageId: 'commentary-1',
    })
    const beforeFinalComplete = assistantTurn(commentaryComplete)
    expect(beforeFinalComplete.activities).toMatchObject([{
      type: 'intermediate',
      content: '我先检查了文件。',
    }])
    expect(beforeFinalComplete.response).toMatchObject({ text: '最终结论。', isStreaming: true })
    expect(commentaryComplete.streaming).toMatchObject({
      content: '最终结论。',
      phase: 'final',
      turnId: 'final-segment',
    })

    const completed = handleTextComplete(commentaryComplete, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '最终结论。',
      isIntermediate: false,
      turnId: 'final-segment',
      messageId: 'answer-1',
    })
    const completedTurn = assistantTurn(completed)
    expect(completedTurn.activities[0]?.content).toBe('我先检查了文件。')
    expect(completedTurn.response).toMatchObject({
      text: '最终结论。',
      isStreaming: false,
      messageId: 'answer-1',
    })
  })

  it('keeps partial text as commentary when the turn is interrupted or fails', () => {
    const partial = handleTextDelta(state(), {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '正在读取文件。',
      phase: 'intermediate',
      turnId: 'message-1',
    })
    const interrupted = handleInterrupted(partial, {
      type: 'interrupted',
      sessionId: 'session-1',
      message: { id: 'stop', role: 'info', content: '已停止', timestamp: Number.MAX_SAFE_INTEGER },
    }).state
    const interruptedTurn = assistantTurn(interrupted, false)
    expect(interruptedTurn.response).toBeUndefined()
    expect(interruptedTurn.activities[0]?.content).toBe('正在读取文件。')

    const failed = handleError(partial, {
      type: 'error',
      sessionId: 'session-1',
      error: '读取失败',
      timestamp: Number.MAX_SAFE_INTEGER,
    }).state
    const failedTurn = assistantTurn(failed, false)
    expect(failedTurn.response).toBeUndefined()
    expect(failedTurn.activities[0]?.content).toBe('正在读取文件。')
  })

  it('promotes a lone intermediate body once without duplicating it', () => {
    const pending = handleTextDelta(state(), {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '这是本轮唯一可交付内容。',
      phase: 'unclassified',
      turnId: 'message-1',
    })
    const completed = handleComplete(pending, {
      type: 'complete',
      sessionId: 'session-1',
    }).state
    const turn = assistantTurn(completed, false)

    expect(turn.response?.text).toBe('这是本轮唯一可交付内容。')
    expect(turn.activities).toEqual([])
  })
})


it('原生正文在完成事件之前逐段可见，尚未收到的尾部不参与布局', () => {
  let current = state()
  current = handleTextDelta(current, { type: 'text_delta', sessionId: 'session-1', turnId: 'native', phase: 'unclassified', delta: '第一段。\n\n第二' })
  const first = assistantTurn(current).response!
  expect(completedParagraphs(first.text, first.isStreaming)).toBe('第一段。\n\n')
  current = handleTextDelta(current, { type: 'text_delta', sessionId: 'session-1', turnId: 'native', phase: 'unclassified', delta: '段。\n\n第三' })
  const second = assistantTurn(current).response!
  expect(completedParagraphs(second.text, second.isStreaming)).toBe('第一段。\n\n第二段。\n\n')
  expect(second.isStreaming).toBe(true)
})

it('marker-v1 keeps unclassified text out of the response and does not promote an empty final', () => {
  const current = handleTextDelta(state(), { type: 'text_delta', sessionId: 'session-1', turnId: 'process',
    presentationProtocol: 'marker-v1', phase: 'unclassified', delta: '查询完成，但尚未产生最终答案。' })
  expect(assistantTurn(current).response).toBeUndefined()
  const finished = handleTextComplete(current, { type: 'text_complete', sessionId: 'session-1', turnId: 'process',
    presentationProtocol: 'marker-v1', phase: 'intermediate', isIntermediate: true, text: '查询完成，但尚未产生最终答案。' })
  expect(assistantTurn(finished, false).response).toBeUndefined()
})


it('closes whitespace commentary before final streaming and leaves no stale thinking row', () => {
  let id = 0
  const decoder = new AnswerBoundary(() => `fragment-${++id}`)
  let current = state()
  const apply = (events: ReturnType<AnswerBoundary['push']>) => {
    for (const event of events) {
      if (event.type === 'text_delta') {
        current = handleTextDelta(current, { ...event, sessionId: 'session-1', delta: event.text })
      } else if (event.type === 'text_complete') {
        current = handleTextComplete(current, { ...event, sessionId: 'session-1' })
      }
    }
  }
  apply(decoder.push('\n\r\n'))
  expect(assistantTurn(current).activities.some(a => a.status === 'running')).toBe(true)
  apply(decoder.push('<<<FINAL_ANSWER>>>\n第一段正文。\n\n'))
  const live = assistantTurn(current)
  expect(live.activities).toEqual([])
  expect(live.response).toMatchObject({ text: '第一段正文。\n\n', isStreaming: true })
  apply(decoder.finish(true))
  expect(assistantTurn(current, false).activities).toEqual([])
  expect(current.session.messages.some(m => m.isPending)).toBe(false)
})


it('message completion does not complete the work header while the agent is processing', () => {
  const current = handleTextComplete(state(), {
    type: 'text_complete', sessionId: 'session-1', text: '已有内容',
    turnId: 'answer', isIntermediate: false,
  })
  expect(deriveTurnPhase(assistantTurn(current, true))).toBe('pending')
  expect(deriveTurnPhase(assistantTurn(current, false))).toBe('complete')
})
