import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { storedToMessage, type AgentEvent, type Message } from '@craft-agent/core'
import type { AnswerDeliveryControl } from '@craft-agent/shared/agent/backend/types'
import { loadSession } from '@craft-agent/shared/sessions'
import { createManagedSession, SessionManager } from '../../../../../packages/server-core/src/sessions/SessionManager'
import { groupMessagesByTurn } from '@craft-agent/ui/chat/turn-utils'
import { processEvent } from '../../renderer/event-processor/processor'
import type { AgentEvent as RendererEvent, SessionState } from '../../renderer/event-processor/types'

const explanation = '蒙提霍尔问题\n\n1. 主持人知道车的位置。\n2. 必须打开未选中的羊门并提供换门。\n\n| 策略 | 胜率 |\n| --- | --- |\n| 换门 | 2/3 |\n| 不换门 | 1/3 |'
const answer = `${explanation}\n\n模拟结果：换门约为 66.67%，不换门约为 33.33%。`
const assistantTurns = (messages: Message[]) => groupMessagesByTurn(messages).filter(t => t.type === 'assistant')

describe('#330 service → renderer → durable reload → turn grouping', () => {
  for (const phase of ['final', 'unclassified'] as const) {
    for (const recover of [false, true]) {
      it(`${phase}, recovery=${recover}: retains one complete answer and its work chain`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'answer-pipeline-'))
        const manager = new SessionManager()
        const managed = createManagedSession({ id: 'pipeline' },
          { id: 'workspace', slug: 'workspace', name: 'Test', rootPath: root, createdAt: Date.now() }, { messagesLoaded: true })
        let control: AnswerDeliveryControl | undefined
        let calls = 0
        const events: RendererEvent[] = []
        const agent = {
          configureAnswerDelivery(value: AnswerDeliveryControl | undefined) { control = value },
          setAllSources() {}, getModel() { return 'fixture' }, getSessionId() { return 'sdk-session' },
          async *chat(): AsyncGenerator<AgentEvent> {
            calls++
            if (calls === 1) {
              yield { type: 'text_complete', text: explanation, phase, turnId: 'provider-1' }
              yield { type: 'tool_start', toolName: 'Bash', toolUseId: 'simulation', input: {} }
              yield { type: 'tool_result', toolName: 'Bash', toolUseId: 'simulation', result: '0.6667', isError: false }
              yield { type: 'text_complete', text: '模拟确认了结论。', phase, turnId: 'provider-2' }
            }
            if (!recover || calls === 2) {
              yield { type: 'tool_start', toolName: 'submit_answer', toolUseId: 'delivery', input: { markdown: answer } }
              await control!.submit({ markdown: answer, toolCallId: 'delivery', sdkMessageId: 'sdk-answer', sdkTurnAnchor: 'sdk-entry' })
              yield { type: 'tool_result', toolName: 'submit_answer', toolUseId: 'delivery', result: 'Answer delivered.', isError: false }
              yield { type: 'text_complete', text: '迟到短句不能覆盖正文。', phase, turnId: 'provider-3' }
            }
            yield { type: 'complete' }
          },
        }
        // Inject only the model boundary; persistence and event processing are real.
        const internals = manager as unknown as {
          sessions: Map<string, typeof managed>
          getOrCreateAgent: () => Promise<typeof agent>
        }
        internals.sessions.set(managed.id, managed)
        internals.getOrCreateAgent = async () => agent
        manager.setEventSink((_channel, _target, event) => events.push(event as RendererEvent))
        try {
          await manager.sendMessage(managed.id, '完整讲解后验证蒙提霍尔问题')
          await manager.flushSession(managed.id)
          let state: SessionState = {
            session: { id: managed.id, workspaceId: 'workspace', workspaceName: 'Test', messages: [], isProcessing: true, lastMessageAt: 0 },
            streaming: null,
          }
          let delivered = false
          for (const event of events) {
            state = processEvent(state, event).state
            if (event.type === 'text_complete' && event.answerCommitted) delivered = true
            if (!delivered) expect(assistantTurns(state.session.messages).every(t => !t.response)).toBe(true)
          }
          const stored = loadSession(root, managed.id)!
          const reloaded = stored.messages.map(storedToMessage)
          const liveTurns = assistantTurns(state.session.messages)
          const loadedTurns = assistantTurns(reloaded)
          expect(calls).toBe(recover ? 2 : 1)
          expect(stored.messages.find(m => m.type === 'user')?.answerRecoveryAttempted).toBe(recover)
          expect(liveTurns).toHaveLength(1)
          expect(loadedTurns).toHaveLength(1)
          expect(loadedTurns[0]!.response).toEqual(liveTurns[0]!.response)
          expect(loadedTurns[0]!.response?.text).toBe(answer)
          expect(loadedTurns[0]!.activities.some(a => a.type === 'intermediate' && a.content === explanation)).toBe(true)
          expect(loadedTurns[0]!.activities.some(a => a.type === 'tool')).toBe(true)
          expect(reloaded.filter(m => m.answerCommitted)).toHaveLength(1)
          // Replayed completion/receipt events must not duplicate or demote it.
          for (const event of events.filter(e => e.type === 'complete' || (e.type === 'text_complete' && e.answerCommitted))) {
            state = processEvent(state, event).state
          }
          expect(assistantTurns(state.session.messages)).toEqual(liveTurns)
        } finally {
          await manager.flushSession(managed.id)
          rmSync(root, { recursive: true, force: true })
        }
      })
    }
  }
})
