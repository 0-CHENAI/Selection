import { describe, expect, it } from 'bun:test'
import { groupMessagesByTurn } from '@craft-agent/ui/chat/turn-utils'
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
  it('keeps unclassified text in the work chain until completion proves it is final', () => {
    const pending = handleTextDelta(state(), {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '我先检查配置。',
      phase: 'unclassified',
      turnId: 'message-1',
    })
    const pendingTurn = assistantTurn(pending)
    expect(pendingTurn.response).toBeUndefined()
    expect(pendingTurn.activities).toMatchObject([{
      type: 'intermediate',
      status: 'running',
      content: '我先检查配置。',
    }])

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

  it('streams into the response card only after an explicit final phase', () => {
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
    expect(turn.response).toMatchObject({
      text: '测试全部通过',
      isStreaming: true,
    })
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
    expect(beforeFinalComplete.response).toMatchObject({
      text: '最终结论。',
      isStreaming: true,
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
      phase: 'unclassified',
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
