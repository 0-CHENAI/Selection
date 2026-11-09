import { expect, test } from 'bun:test'
import type { ClarificationAsk, ClarificationGate } from '@craft-agent/session-tools-core'
import { SessionManager, createManagedSession } from './SessionManager'

const ask: ClarificationAsk = {
  question: '范围是哪一年？',
  ambiguity: 'scope',
  selection: 'single',
  options: [{ id: 'a', label: '2024' }, { id: 'b', label: '2025' }],
}

function setup() {
  const manager = new SessionManager()
  const internal = manager as unknown as {
    sessions: Map<string, ReturnType<typeof createManagedSession>>
    persistSession: () => void
    beginClarification: (session: ReturnType<typeof createManagedSession>, request: ClarificationAsk) => ClarificationGate
    processNextQueuedMessage: (sessionId: string) => Promise<void>
    supersedePendingClarification: (session: ReturnType<typeof createManagedSession>) => void
  }
  const workspace = { id: 'ws', slug: 'ws', name: 'Workspace', rootPath: '/tmp/selection-clarify-test', createdAt: 0 }
  const root = createManagedSession({ id: 'root', workMode: 'PRO' }, workspace, {
    messagesLoaded: true,
    messages: [{ id: 'root-user', role: 'user', content: '编排这个任务', timestamp: 1 }],
  })
  const worker = createManagedSession({
    id: 'worker',
    workMode: 'PRO',
    parentSessionId: 'root',
    executionRootSessionId: 'root',
  }, workspace, {
    messagesLoaded: true,
    messages: [{ id: 'worker-user', role: 'user', content: '做一下那个方案', timestamp: 1 }],
  })
  internal.sessions.set(root.id, root)
  internal.sessions.set(worker.id, worker)
  internal.persistSession = () => {}
  const events: Array<{ type: string; sessionId?: string; pause?: boolean }> = []
  manager.setEventSink((_channel, _target, event) => { events.push(event) })
  const sent: Array<{ id: string; message: string; hidden?: boolean }> = []
  manager.sendMessage = async (id, message, _attachments, _stored, options) => {
    sent.push({ id, message, hidden: options?.hidden })
  }
  worker.isProcessing = true
  const reasons: string[] = []
  worker.agent = {
    interruptForHandoff(reason: string) { reasons.push(reason) },
    destroy() {},
  } as typeof worker.agent
  return { manager, internal, root, worker, events, sent, reasons }
}

test('a worker card is mirrored, blocks a second ask, and an answer resumes only the asker', async () => {
  const { manager, internal, root, worker, events, sent, reasons } = setup()
  try {
    const first = internal.beginClarification(worker, ask)
    expect(first).toMatchObject({ accepted: true, round: 1 })
    expect(reasons).toEqual(['clarification'])
    expect(worker.isProcessing).toBe(false)
    expect(worker.messages.filter(message => message.role === 'clarification' && !message.clarification?.mirror)).toHaveLength(1)
    expect(root.messages.filter(message => message.clarification?.mirror)).toHaveLength(1)
    expect(root.messages[1]?.clarification?.originSessionId).toBe('worker')
    expect(events.filter(event => event.type === 'clarification_request').map(event => event.pause)).toEqual([true, false])

    worker.messageQueue.push({ message: '稍后继续', messageId: 'queued' })
    await internal.processNextQueuedMessage(worker.id)
    expect(worker.messageQueue).toHaveLength(1)
    expect(sent).toHaveLength(0)

    const second = internal.beginClarification(worker, { ...ask, critical: true })
    expect(second.accepted).toBe(false)
    if (!second.accepted) expect(second.reason).toContain('already waiting')

    internal.supersedePendingClarification(root)
    expect(worker.messages.at(-1)?.clarification?.status).toBe('pending')
    internal.supersedePendingClarification(worker)
    expect(worker.messages.at(-1)?.clarification?.status).toBe('skipped')
    expect(root.messages.at(-1)?.clarification?.status).toBe('skipped')

    worker.messages.push({ id: 'next-user', role: 'user', content: '换一个目标', timestamp: 20 })
    const again = internal.beginClarification(worker, ask)
    expect(again.accepted).toBe(true)
    if (!again.accepted) return
    const answered = await manager.respondToClarification(root.id, again.requestId, {
      skipped: false,
      optionIds: ['b'],
      text: '再加一季度',
    })
    expect(answered).toBe(true)
    expect(sent.map(item => item.id)).toEqual(['worker'])
    expect(sent[0]?.hidden).toBe(true)
    expect(sent[0]?.message).toContain('2025')
    expect(sent[0]?.message).toContain('再加一季度')
    expect(worker.messages.at(-1)?.clarification?.status).toBe('answered')
    expect(root.messages.at(-1)?.clarification?.status).toBe('answered')
    expect(worker.messageQueue).toHaveLength(1)
  } finally {
    manager.cleanup()
  }
})

test('soft cap allows one critical extra and then refuses', () => {
  const { manager, internal, worker } = setup()
  try {
    for (let round = 1; round <= 3; round += 1) {
      const gate = internal.beginClarification(worker, ask)
      expect(gate).toMatchObject({ accepted: true, round })
      const card = worker.messages.at(-1)?.clarification
      expect(card?.status).toBe('pending')
      card!.status = 'answered'
    }
    const soft = internal.beginClarification(worker, ask)
    expect(soft.accepted).toBe(false)
    const extra = internal.beginClarification(worker, { ...ask, critical: true })
    expect(extra).toMatchObject({ accepted: true, round: 4 })
    worker.messages.at(-1)!.clarification!.status = 'answered'
    const hard = internal.beginClarification(worker, { ...ask, critical: true })
    expect(hard.accepted).toBe(false)
    if (!hard.accepted) expect(hard.reason).toContain('limit')
  } finally {
    manager.cleanup()
  }
})

test('a failed continuation restores the card unless the answer was already stored', async () => {
  const { manager, internal, root, worker } = setup()
  try {
    const gate = internal.beginClarification(worker, ask)
    expect(gate.accepted).toBe(true)
    if (!gate.accepted) return
    manager.sendMessage = async () => { throw new Error('not started') }
    expect(await manager.respondToClarification(worker.id, gate.requestId, { skipped: true })).toBe(false)
    expect(worker.messages.at(-1)?.clarification?.status).toBe('pending')

    manager.sendMessage = async (_id, message) => {
      worker.messages.push({ id: 'hidden-answer', role: 'user', content: message, timestamp: 30, hidden: true })
      throw new Error('after accept')
    }
    expect(await manager.respondToClarification(worker.id, gate.requestId, {
      skipped: false, optionIds: ['a'], text: '只要这一年',
    })).toBe(false)
    expect(worker.messages.find(message => message.clarification?.requestId === gate.requestId)?.clarification?.status).toBe('answered')

    const waiting = internal.beginClarification(worker, { ...ask, question: '还有哪个约束？', ambiguity: 'constraints' })
    expect(waiting.accepted).toBe(true)
    if (!waiting.accepted) return
    internal.sessions.delete(worker.id)
    expect(await manager.respondToClarification(root.id, waiting.requestId, { skipped: false, optionIds: ['a'] })).toBe(false)
    expect(root.messages.find(message => message.clarification?.requestId === waiting.requestId)?.clarification?.status).toBe('skipped')
  } finally {
    manager.cleanup()
  }
})
