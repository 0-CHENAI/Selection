import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '@craft-agent/core'
import { storedToMessage } from '@craft-agent/core'
import type { AnswerDeliveryControl } from '@craft-agent/shared/agent/backend/types'
import { getSessionPath, loadSession as loadStoredSession } from '@craft-agent/shared/sessions'
import { createManagedSession, loadPiTurnAnchors, SessionManager } from './SessionManager'

const explanation = '蒙提霍尔问题\n\n1. 三扇门，主持人知道奖品位置。\n2. 主持人打开一扇有羊的门。\n\n| 策略 | 胜率 |\n| --- | --- |\n| 换门 | 2/3 |\n| 不换 | 1/3 |'
const markdown = `${explanation}\n\n模拟结果：换门胜率约为 2/3。`
const submission = { markdown, toolCallId: 'submit-330', sdkMessageId: 'sdk-message', sdkTurnAnchor: 'sdk-assistant-entry' }

describe('explicit answer delivery lifecycle (#330)', () => {
  let root: string
  let manager: SessionManager
  let managed: ReturnType<typeof createManagedSession>
  let events: any[]
  let control: AnswerDeliveryControl | undefined
  let prompts: string[]
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'selection-answer-'))
    manager = new SessionManager()
    managed = createManagedSession({ id: 'answer-test', name: 'Existing session' },
      { id: 'workspace', name: 'Workspace', rootPath: root, createdAt: Date.now() } as never,
      { messagesLoaded: true })
    ;(manager as any).sessions.set(managed.id, managed)
    events = []; prompts = []; control = undefined
    manager.setEventSink((_channel, _target, event) => events.push(event))
  })
  afterEach(async () => { await manager.flushSession(managed.id); rmSync(root, { recursive: true, force: true }) })
  function install(chat: (index: number) => AsyncGenerator<AgentEvent>) {
    const agent = {
      configureAnswerDelivery(value: AnswerDeliveryControl | undefined) { control = value },
      setAllSources() {}, getModel() { return 'test-model' }, getSessionId() { return 'sdk-session' },
      chat(prompt: string) { prompts.push(prompt); return chat(prompts.length) },
    }
    ;(manager as any).getOrCreateAgent = async () => agent
    return agent
  }
  it('persists complete Markdown before publication and survives rehydration plus late events', async () => {
    let persistedBeforeEvent = false
    manager.setEventSink((_channel, _target, event: any) => {
      events.push(event)
      if (event.answerCommitted) {
        persistedBeforeEvent = !!loadStoredSession(root, managed.id)?.messages.find(m => m.id === event.messageId && m.content === markdown)
      }
    })
    install(async function* () {
      yield { type: 'text_complete', text: explanation, phase: 'final' }
      yield { type: 'tool_start', toolName: 'Bash', toolUseId: 'simulation', input: { command: 'simulate' } }
      yield { type: 'tool_result', toolUseId: 'simulation', result: '0.6667', isError: false }
      yield { type: 'text_complete', text: '模拟证实了结果。' }
      yield { type: 'tool_start', toolName: 'submit_answer', toolUseId: submission.toolCallId, input: { markdown } }
      await control!.submit(submission)
      yield { type: 'tool_result', toolName: 'submit_answer', toolUseId: submission.toolCallId, result: 'Answer delivered.', isError: false }
      yield { type: 'pi_turn_anchor', sdkMessageId: submission.sdkMessageId, sdkTurnAnchor: 'sdk-tool-result-entry' }
      yield { type: 'text_complete', text: '已完成。' }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释蒙提霍尔问题并验证')
    expect(persistedBeforeEvent).toBe(true)
    expect(prompts).toHaveLength(1)
    expect(managed.messages.filter(m => m.answerCommitted)).toHaveLength(1)
    expect(managed.messages.find(m => m.toolUseId === submission.toolCallId)?.toolInput).toEqual({})
    const stored = loadStoredSession(root, managed.id)!
    const delivered = stored.messages.map(storedToMessage).filter(m => m.answerCommitted)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.content).toBe(markdown)
    const answer = managed.messages.find(m => m.answerCommitted)!
    expect((await loadPiTurnAnchors(getSessionPath(root, managed.id))).anchors[answer.id]).toBe('sdk-tool-result-entry')
    expect(events.filter(e => e.answerCommitted)).toHaveLength(1)
    expect(managed.isProcessing).toBe(false)
  })
  it('recovers once in the retained task and persists the recovery attempt', async () => {
    install(async function* (index) {
      if (index === 1) yield { type: 'text_complete', text: explanation }
      else { expect(control?.recovery).toBe(true); await control!.submit(submission) }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释并验证')
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('Only submit_answer')
    expect(managed.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(loadStoredSession(root, managed.id)?.messages.find(m => m.type === 'user')?.answerRecoveryAttempted).toBe(true)
    expect(managed.messages.find(m => m.answerCommitted)?.content).toBe(markdown)
  })
  it('ends with an explicit error when recovery also omits delivery', async () => {
    install(async function* () { yield { type: 'text_complete', text: '一句补充' }; yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '解释并验证')
    expect(prompts).toHaveLength(2)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
    expect(managed.messages.find(m => m.role === 'error')?.content).toContain('未完成答案交付')
  })
  it('rejects duplicate submissions without replacing the committed answer', async () => {
    install(async function* () {
      await control!.submit(submission)
      await expect(control!.submit({ ...submission, markdown: '短句' })).rejects.toThrow('already')
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(managed.messages.filter(m => m.answerCommitted).map(m => m.content)).toEqual([markdown])
  })
  it('accepts at most one concurrent submission', async () => {
    install(async function* () {
      const first = control!.submit(submission)
      await expect(control!.submit({ ...submission, toolCallId: 'second', markdown: '重复正文' })).rejects.toThrow('already')
      await first
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(managed.messages.filter(m => m.answerCommitted)).toHaveLength(1)
  })
  it('does not publish when the durable flush fails', async () => {
    install(async function* () {
      const flush = manager.flushSession.bind(manager)
      manager.flushSession = async () => { throw new Error('disk unavailable') }
      try { await expect(control!.submit(submission)).rejects.toThrow('disk unavailable') }
      finally { manager.flushSession = flush }
      yield { type: 'error', message: 'disk unavailable' }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(events.some(e => e.answerCommitted)).toBe(false)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
    expect(prompts).toHaveLength(1)
  })
  it('rejects outstanding tools before accepting an answer', async () => {
    install(async function* () {
      yield { type: 'tool_start', toolName: 'Bash', toolUseId: 'running', input: {} }
      await expect(control!.submit(submission)).rejects.toThrow('foreground')
      yield { type: 'tool_result', toolUseId: 'running', result: 'done', isError: false }
      await control!.submit(submission)
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(managed.messages.filter(m => m.answerCommitted)).toHaveLength(1)
  })
  it('does not recover an errored turn', async () => {
    install(async function* () { yield { type: 'error', message: 'provider unavailable' }; yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '解释')
    expect(prompts).toHaveLength(1)
  })
  it('does not recover a stopped turn or accept an obsolete submission', async () => {
    install(async function* () { managed.stopRequested = true; await expect(control!.submit(submission)).rejects.toThrow('no longer'); yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '解释')
    expect(prompts).toHaveLength(1)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
  })
  it('keeps worker and task output sessions on their existing protocol', async () => {
    managed.parentSessionId = 'parent'
    install(async function* () { expect(control).toBeUndefined(); yield { type: 'text_complete', text: 'worker result' }; yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '执行子任务')
    expect(prompts).toHaveLength(1)
    expect(managed.messages.find(m => m.role === 'assistant')?.isIntermediate).toBeFalsy()
  })
  it('does not recover during plan/auth handoff', async () => {
    install(async function* () { managed.isProcessing = false; yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '先制定计划')
    expect(prompts).toHaveLength(1)
  })
  it('does not retry or accept delivery while waiting for Swarm workers', async () => {
    install(async function* () {
      managed.orchestrationStatus = 'running'
      managed.orchestrationAggregation = { phase: 'waiting-workers', orchestrationId: 'swarm' } as any
      managed.orchestrationId = 'swarm'
      await expect(control!.submit(submission)).rejects.toThrow('Swarm')
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '并行执行')
    expect(prompts).toHaveLength(1)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
  })
  it('does not start recovery after cancellation during its durable checkpoint', async () => {
    install(async function* () {
      const flush = manager.flushSession.bind(manager)
      manager.flushSession = async id => { await flush(id); managed.stopRequested = true }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(prompts).toHaveLength(1)
  })
  it('does not publish an answer cancelled during persistence', async () => {
    install(async function* () {
      const flush = manager.flushSession.bind(manager)
      manager.flushSession = async id => { await flush(id); managed.stopRequested = true }
      await expect(control!.submit(submission)).rejects.toThrow('interrupted')
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(events.some(e => e.answerCommitted)).toBe(false)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
  })

})
