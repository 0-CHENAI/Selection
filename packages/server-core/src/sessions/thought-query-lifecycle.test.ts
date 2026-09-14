import { expect, it } from 'bun:test'
import { SessionManager } from './SessionManager'

it('requires explicit workbench replay instead of auth retry or transcript regeneration', async () => {
  const messages = [{ role: 'user', content: 'frozen graph' }]
  const managed = { messages, lastSentMessage: 'frozen graph', lastSentOptions: { strictInput: true, inputHash: 'snapshot' }, isProcessing: false }
  const owner = { sessions: new Map([['session', managed]]), sessionSourceUpdateLocks: new Map() }
  const retry = (SessionManager.prototype as any).attemptAuthRetry.call(owner, 'session', managed, 'workspace')
  expect(retry).toBe(false)
  await expect(SessionManager.prototype.regenerateLastResponse.call(owner as unknown as SessionManager, 'session')).rejects.toThrow('fresh input preview')
  expect(managed.messages).toEqual([{ role: 'user', content: 'frozen graph' }])
  expect(managed.isProcessing).toBe(false)
  expect('authRetryInProgress' in managed).toBe(false)
})

it('expires only unused preview drafts, preserving conversations and running sessions', async () => {
  const deleted: string[] = []
  const owner = { sessions: new Map([
    ['unused', { taskDraft: true, messages: [], isProcessing: false }],
    ['used', { taskDraft: true, messages: [{ role: 'user' }], isProcessing: false }],
    ['running', { taskDraft: true, messages: [], isProcessing: true }],
    ['ordinary', { taskDraft: false, messages: [], isProcessing: false }],
  ]), async deleteSession(id: string) { deleted.push(id) } }
  for (const id of ['unused', 'used', 'running', 'ordinary', 'missing']) await SessionManager.prototype.discardThoughtPreview.call(owner as unknown as SessionManager, id)
  expect(deleted).toEqual(['unused'])
})

it('rejects a consumed preview session before persisting another user message', async () => {
  const owner = { sessions: new Map([['used', { taskDraft: true, messages: [{ role: 'user' }], isProcessing: false }]]) }
  await expect(SessionManager.prototype.sendMessage.call(owner as unknown as SessionManager, 'used', 'graph', undefined, undefined, { inputHash: 'old' })).rejects.toThrow('no longer fresh')
})

it.each(['initialization', 'sources', 'snapshot'])('discards Agent previews cancelled during %s', async phase => {
  let finish!: () => void
  const pendingStep = new Promise<void>(resolve => { finish = resolve })
  let snapshotCalls = 0
  const managed = { taskDraft: true, messages: [], processingGeneration: 0, deleting: false, stopRequested: false, isProcessing: false }
  const owner = {
    thoughtQueries: new Set<string>(), sessions: new Map([['session', managed]]),
    async getOrCreateAgent() {
      if (phase === 'initialization') await pendingStep
      return { async prepareThoughtInput() { snapshotCalls++; if (phase === 'snapshot') await pendingStep; return { hash: 'must-not-publish' } } }
    },
    async reloadSessionSources() { if (phase === 'sources') await pendingStep },
  }
  const manager = owner as unknown as SessionManager
  const pending = SessionManager.prototype.prepareThoughtAgentInput.call(manager, 'session', 'graph')
  await Promise.resolve()
  await Promise.resolve()
  await expect(SessionManager.prototype.prepareThoughtAgentInput.call(manager, 'session', 'duplicate')).rejects.toThrow('already running')
  managed.stopRequested = true
  managed.processingGeneration++
  finish()
  await expect(pending).rejects.toThrow('cancelled')
  expect(snapshotCalls).toBe(phase === 'snapshot' ? 1 : 0)
  expect(owner.thoughtQueries.size).toBe(0)
})

it('isolates output observers and makes repeated unsubscribe safe after resubscription', () => {
  const owner = { thoughtOutputListeners: new Map(), sessions: new Map(), eventSink() {} }
  const manager = owner as unknown as SessionManager
  const observed: unknown[] = []
  const subscribe = (listener: (output: { kind: 'process' | 'preview'; text: string }) => void) => SessionManager.prototype.onThoughtOutput.call(manager, 'session', listener)
  const first = subscribe(() => {})
  first()
  const second = subscribe(output => observed.push(output))
  first()
  const broken = subscribe(() => { throw new Error('observer error') })
  const emit = (sessionId: string, type: string, text: string) => (SessionManager.prototype as any).sendEvent.call(manager, { sessionId, type, ...(type === 'text_delta' ? { delta: text } : { text }) }, 'workspace')
  emit('other', 'text_delta', 'foreign')
  emit('session', 'text_delta', 'progress')
  broken()
  emit('session', 'answer_preview', 'draft')
  expect(observed).toEqual([{ kind: 'process', text: 'progress' }, { kind: 'preview', text: 'draft' }])
  second()
  emit('session', 'text_delta', 'late')
  expect(observed).toHaveLength(2)
  expect(owner.thoughtOutputListeners.size).toBe(0)
})

it('does not dispatch a model query if deletion wins during backend initialization', async () => {
  let finish!: () => void
  const ready = new Promise<void>(resolve => { finish = resolve })
  let calls = 0
  const managed = { taskDraft: true, messages: [], processingGeneration: 0, deleting: false, stopRequested: false }
  const owner = {
    thoughtQueries: new Set<string>(),
    sessions: new Map([['session', managed]]),
    async getOrCreateAgent() { await ready; return { async queryLlm() { calls++; return { text: 'late' } } } },
  }
  const pending = SessionManager.prototype.queryThoughtContext.call(owner as unknown as SessionManager, 'session', { prompt: 'question' })
  managed.deleting = true
  managed.processingGeneration++
  finish()
  await expect(pending).rejects.toThrow('cancelled before model dispatch')
  expect(calls).toBe(0)
  expect(owner.thoughtQueries.size).toBe(0)
})

it('forwards cancellation of an isolated query even outside normal chat processing', async () => {
  let aborted = 0
  const managed = { isProcessing: false, stopRequested: false, processingGeneration: 1, agent: { forceAbort() { aborted++ } } }
  const owner = { sessions: new Map([['session', managed]]), thoughtQueries: new Set(['session']) }
  await SessionManager.prototype.cancelProcessing.call(owner as unknown as SessionManager, 'session', true)
  expect(aborted).toBe(1)
  expect(managed.stopRequested).toBe(true)
  expect(managed.processingGeneration).toBe(2)
})
