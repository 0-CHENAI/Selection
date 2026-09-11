import { describe, expect, it } from 'bun:test'
import { processEvent } from '../../processor'
import type { AgentEvent, SessionState } from '../../types'
import { groupMessagesByTurn } from '@craft-agent/ui/chat/turn-utils'

const initial = (): SessionState => ({
  session: { id: 's', workspaceId: 'w', workspaceName: 'Test', lastMessageAt: 1, isProcessing: true, messages: [
    { id: 'user', role: 'user', content: '解释', timestamp: 1 },
  ] }, streaming: null,
})
const preview = { type: 'answer_preview', sessionId: 's', userMessageId: 'user', answerRunId: 'run', toolCallId: 'tool', text: '# 正文\n\n正在生成' } as const
const turns = (s: SessionState) => groupMessagesByTurn(s.session.messages, { isManagedSwarmRunning: true, isTaskOrchestrationRunning: true }).filter(t => t.type === 'assistant')
const send = (s: SessionState, e: AgentEvent) => processEvent(s, e).state

describe('transient answer preview (#350)', () => {
  it('shows replacement snapshots in one streaming card, then commits the authoritative body', () => {
    let state = send(initial(), preview)
    const turnId = turns(state)[0]!.turnId
    expect(turns(state)[0]).toMatchObject({ isComplete: false, response: { isStreaming: true, isAnswerPreview: true, text: preview.text } })
    state = send(state, { ...preview, text: `${preview.text}，第二段` })
    expect(state.session.messages.filter(m => m.answerPreview)).toHaveLength(1)
    state = send(state, { type: 'tool_start', sessionId: 's', toolUseId: 'tool', toolName: 'submit_answer', toolInput: {}, answerRunId: 'run', answerProtocol: 'explicit-v1' })
    expect(state.session.messages.find(m => m.answerPreview)?.content).toBe(`${preview.text}，第二段`)
    expect(state.session.messages.find(m => m.toolUseId === 'tool')?.role).toBe('tool')
    state = send(state, { type: 'text_complete', sessionId: 's', text: '服务端接受的最终正文', answerProtocol: 'explicit-v1', answerRunId: 'run', answerCommitted: true, messageId: 'accepted', timestamp: 10 })
    expect(state.session.messages.some(m => m.answerPreview)).toBe(false)
    expect(turns(state)).toHaveLength(1)
    expect(turns(state)[0]).toMatchObject({ turnId, isComplete: true, response: { text: '服务端接受的最终正文', messageId: 'accepted' } })
    expect(send(state, preview)).toEqual(state)
  })
  it('drops previews on errors, cancellation and undelivered completion', () => {
    for (const event of [
      { type: 'error', sessionId: 's', error: '失败' },
      { type: 'interrupted', sessionId: 's' },
      { type: 'complete', sessionId: 's' },
    ] as AgentEvent[]) {
      const stopped = send(send(initial(), preview), event)
      expect(stopped.session.messages.some(m => m.answerPreview || m.answerCommitted)).toBe(false)
      expect(turns(stopped).every(t => !t.response)).toBe(true)
      expect(send(stopped, preview)).toEqual(stopped)
    }
  })
  it('clears only the rejected call and rejects a superseded user turn', () => {
    const state = send(initial(), preview)
    expect(send(state, { ...preview, text: '', toolCallId: 'other' })).toEqual(state)
    expect(send(state, { ...preview, text: '' }).session.messages.some(m => m.answerPreview)).toBe(false)
    const next = initial()
    next.session.messages.push({ id: 'next-user', role: 'user', content: '新问题', timestamp: 20 })
    expect(send(next, preview)).toEqual(next)
  })
})
