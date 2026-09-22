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
    for (const delivery of ['direct', 'recovered', 'salvaged'] as const) {
      const recover = delivery !== 'direct'
      it(`${phase}, delivery=${delivery}: retains one complete answer and its work chain`, async () => {
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
              expect(events.some(e => e.type === 'answer_preview')).toBe(false)
            }
            if (delivery === 'salvaged' && calls === 2) {
              const split = answer.indexOf('\n\n')
              yield { type: 'text_delta', text: answer.slice(0, split), phase, turnId: 'provider-recovery' }
              ;(manager as any).flushDelta(managed.id, managed.workspace.id)
              expect(events.filter(e => e.type === 'answer_preview').at(-1)).toMatchObject({ text: answer.slice(0, split) })
              expect(managed.messages.some(m => m.answerCommitted || m.answerPreview)).toBe(false)
              yield { type: 'text_delta', text: answer.slice(split), phase, turnId: 'provider-recovery' }
              ;(manager as any).flushDelta(managed.id, managed.workspace.id)
              expect(events.filter(e => e.type === 'answer_preview').at(-1)).toMatchObject({ text: answer })
              yield { type: 'text_complete', text: answer, phase, turnId: 'provider-recovery', sdkMessageId: 'sdk-recovery' }
              yield { type: 'pi_turn_anchor', sdkMessageId: 'sdk-recovery', sdkTurnAnchor: 'recovery-entry' }
            } else if (delivery !== 'salvaged' && (!recover || calls === 2)) {
              yield { type: 'answer_preview', toolCallId: 'delivery', text: answer.slice(0, 30) }
              await manager.flushSession(managed.id)
              expect(loadSession(root, managed.id)?.messages.some(m => m.content === answer.slice(0, 30))).toBe(false)
              yield { type: 'answer_preview', toolCallId: 'delivery', text: answer }
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
          let previewSeen = false
          for (const event of events) {
            state = processEvent(state, event).state
            if (event.type === 'answer_preview' && event.text) {
              previewSeen = true
              expect(assistantTurns(state.session.messages)[0]?.response?.isAnswerPreview).toBe(true)
              expect(assistantTurns(state.session.messages)[0]?.isComplete).toBe(false)
            }
            if (event.type === 'text_complete' && event.answerCommitted) delivered = true
            if (!delivered && !previewSeen) {
              for (const turn of assistantTurns(state.session.messages)) {
                expect(turn.isComplete).toBe(false)
                expect(turn.response?.isAnswerPreview).toBeFalsy()
                if (turn.response) expect(!!(turn.response.isCommentary || turn.response.isStreaming)).toBe(true)
              }
            }
          }
          expect(previewSeen).toBe(true)
          const stored = loadSession(root, managed.id)!
          const reloaded = stored.messages.map(storedToMessage)
          const liveTurns = assistantTurns(state.session.messages)
          const loadedTurns = assistantTurns(reloaded)
          expect(calls).toBe(recover ? 2 : 1)
          expect(stored.messages.find(m => m.type === 'user')?.answerRecoveryAttempted).toBe(recover)
          expect(liveTurns).toHaveLength(1)
          expect(loadedTurns).toHaveLength(1)
          expect(liveTurns[0]!.response?.completedRevealStartTime).toBeNumber()
          expect(loadedTurns[0]!.response).toEqual({ ...liveTurns[0]!.response!, completedRevealStartTime: undefined })
          expect(loadedTurns[0]!.response?.text).toBe(answer)
          // Drafts folded by the UI must still survive in the durable execution record.
          expect(reloaded.some(m => m.isIntermediate && m.content === explanation)).toBe(true)
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
