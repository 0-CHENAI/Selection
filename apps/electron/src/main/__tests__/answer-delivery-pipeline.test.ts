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

const note = '我先运行一次模拟来验证结论。'
const explanation = '蒙提霍尔问题\n\n1. 主持人知道车的位置。\n2. 必须打开未选中的羊门并提供换门。\n\n| 策略 | 胜率 |\n| --- | --- |\n| 换门 | 2/3 |\n| 不换门 | 1/3 |'
const answer = `${explanation}\n\n模拟结果：换门约为 66.67%，不换门约为 33.33%。`
const request = '[skill:natural-writing] 完整讲解后验证蒙提霍尔问题'
const assistantTurns = (messages: Message[]) => groupMessagesByTurn(messages).filter(t => t.type === 'assistant')

type Delivery = 'marked' | 'unmarked' | 'recovered' | 'salvaged'

/** What the Pi adapter's answer boundary emits for one final tool-free message. */
function* finalMessage(marked: boolean, turnId: string, sdkMessageId: string): Generator<AgentEvent> {
  const phase = marked ? 'final' : 'intermediate'
  const split = answer.indexOf('\n\n')
  yield { type: 'text_delta', text: answer.slice(0, split), phase, presentationProtocol: 'native', turnId }
  yield { type: 'text_delta', text: answer.slice(split), phase, presentationProtocol: 'native', turnId }
  yield { type: 'text_complete', text: answer, isIntermediate: false, phase: 'final', presentationProtocol: 'native', turnId, sdkMessageId }
  yield { type: 'pi_turn_anchor', sdkMessageId, sdkTurnAnchor: `${sdkMessageId}-entry` }
}

describe('natural-v1 service → renderer → durable reload → turn grouping', () => {
  for (const delivery of ['marked', 'unmarked', 'recovered', 'salvaged'] as Delivery[]) {
    const recover = delivery === 'recovered' || delivery === 'salvaged'
    it(`delivery=${delivery}: streams every text block in the reply slot and keeps one committed answer`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'answer-pipeline-'))
      const manager = new SessionManager()
      const managed = createManagedSession({ id: 'pipeline' },
        { id: 'workspace', slug: 'workspace', name: 'Test', rootPath: root, createdAt: Date.now() }, { messagesLoaded: true })
      let control: AnswerDeliveryControl | undefined
      let calls = 0
      const chatOptions: Array<{ continueUserTask?: boolean; userTaskMessage?: string } | undefined> = []
      const events: RendererEvent[] = []
      const agent = {
        configureAnswerDelivery(value: AnswerDeliveryControl | undefined) { control = value },
        setAllSources() {}, getModel() { return 'fixture' }, getSessionId() { return 'sdk-session' },
        async generateTitle() { return null },
        async *chat(_message: string, _attachments?: unknown, options?: { continueUserTask?: boolean; userTaskMessage?: string }): AsyncGenerator<AgentEvent> {
          calls++
          chatOptions.push(options)
          if (calls === 1) {
            const noteText = delivery === 'salvaged' ? explanation : note
            yield { type: 'text_delta', text: noteText, phase: 'intermediate', presentationProtocol: 'native', turnId: 'note' }
            ;(manager as any).flushDelta(managed.id, managed.workspace.id)
            yield { type: 'text_complete', text: noteText, isIntermediate: true, phase: 'intermediate', presentationProtocol: 'native', turnId: 'note' }
            yield { type: 'tool_start', toolName: 'Bash', toolUseId: 'simulation', input: {} }
            yield { type: 'tool_result', toolName: 'Bash', toolUseId: 'simulation', result: '0.6667', isError: false }
            if (!recover) yield* finalMessage(delivery === 'marked', 'answer', 'sdk-answer')
          } else if (delivery === 'recovered') {
            expect(control?.recovery).toBe(true)
            yield* finalMessage(true, 'recovery', 'sdk-recovery')
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
      managed.agent = agent as never
      manager.setEventSink((_channel, _target, event) => events.push(event as RendererEvent))
      try {
        await manager.sendMessage(managed.id, request)
        await manager.flushSession(managed.id)
        let state: SessionState = {
          session: { id: managed.id, workspaceId: 'workspace', workspaceName: 'Test', messages: [], isProcessing: true, lastMessageAt: 0 },
          streaming: null,
        }
        let delivered = false
        let sawNoteLive = false
        let sawAnswerLive = false
        for (const event of events) {
          state = processEvent(state, event).state
          if (event.type === 'text_complete' && event.answerCommitted) delivered = true
          if (delivered) continue
          const live = assistantTurns(state.session.messages)
          for (const turn of live) {
            expect(turn.isComplete).toBe(false)
            const response = turn.response
            if (!response) continue
            // Every live stream occupies the same frameless reply slot; nothing
            // is final before the host commits it.
            expect(response.isStreaming).toBe(true)
            expect(response.isCommentary).toBeFalsy()
            expect(turn.activities.some(a => a.id === response.messageId)).toBe(false)
            if (response.text === note || response.text === explanation) sawNoteLive = true
            if (response.text === answer) sawAnswerLive = true
          }
        }
        expect(delivered).toBe(true)
        expect(sawNoteLive).toBe(true)
        expect(sawAnswerLive).toBe(delivery !== 'salvaged')
        expect(events.some(e => e.type === 'answer_preview')).toBe(false)
        expect(events.filter(e => e.type === 'text_delta').length).toBeGreaterThan(0)

        const committedText = delivery === 'salvaged' ? explanation : answer
        const stored = loadSession(root, managed.id)!
        const reloaded = stored.messages.map(storedToMessage)
        const liveTurns = assistantTurns(state.session.messages)
        const loadedTurns = assistantTurns(reloaded)
        expect(calls).toBe(recover ? 2 : 1)
        expect(chatOptions[0]?.userTaskMessage).toBe(request)
        if (recover) expect(chatOptions[1]).toMatchObject({ continueUserTask: true, userTaskMessage: request })
        expect(stored.messages.find(m => m.type === 'user')?.answerRecoveryAttempted).toBe(recover)
        expect(liveTurns).toHaveLength(1)
        expect(loadedTurns).toHaveLength(1)
        expect(liveTurns[0]!.response?.text).toBe(committedText)
        expect(liveTurns[0]!.response?.isCommentary).toBeFalsy()
        expect(liveTurns[0]!.response?.answerSalvaged).toBe(delivery === 'salvaged' ? true : undefined)
        // Live rows carry renderer-clock timestamps; content and identity must match reload.
        const comparable = (response: typeof liveTurns[number]['response']) => response && { ...response,
          timestamp: undefined, streamStartTime: undefined, completedRevealStartTime: undefined }
        expect(comparable(loadedTurns[0]!.response)).toEqual(comparable(liveTurns[0]!.response))
        // One renderer message per streamed body: the answer was committed in place.
        expect(state.session.messages.filter(m => m.role === 'assistant' && m.content === committedText)).toHaveLength(1)
        expect(reloaded.filter(m => m.answerCommitted)).toHaveLength(1)
        expect(loadedTurns[0]!.activities.some(a => a.type === 'tool')).toBe(true)
        if (delivery !== 'salvaged') {
          expect(liveTurns[0]!.activities.some(a => a.type === 'intermediate' && a.content === note)).toBe(true)
          expect(loadedTurns[0]!.activities.some(a => a.type === 'intermediate' && a.content === note)).toBe(true)
        }
        // Replayed completion events must not duplicate or demote it.
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
})
