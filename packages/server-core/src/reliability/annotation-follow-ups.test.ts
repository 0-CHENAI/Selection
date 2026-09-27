import { expect, test } from 'bun:test'
import { assertAnnotationSource, linkAnnotationFollowUpResults, prepareAnnotationFollowUps, setAnnotationFeedbackStatus } from './annotation-follow-ups'
import type { Message } from '@craft-agent/core/types'

test('body feedback retains exact original and result after source edits and reply removal', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { SessionManager, createManagedSession } = await import('../sessions/SessionManager')
  const { getSessionPath } = await import('@craft-agent/shared/sessions')
  const { saveBodyFeedbackVersion } = await import('./body-feedback-versions')
  const root = mkdtempSync(join(tmpdir(), 'body-feedback-'))
  try {
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 's' }, { id: 'w', name: 'w', rootPath: root } as never, { messagesLoaded: true })
    managed.messages = fixture()
    const capture = (content: string, hash: string) => saveBodyFeedbackVersion(getSessionPath(root, 's'), content, hash)
    const request: Message = { id: 'request', role: 'user', content: 'Revise', timestamp: 2 }
    prepareAnnotationFollowUps(managed.messages, [{ messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }], capture)('request', request)
    const answer: Message = { id: 'result', role: 'assistant', content: 'Revised\n\n```ts\nconst x = 1\n```', timestamp: 3, answerCommitted: true, answerSalvaged: true }
    managed.messages.push(request)
    linkAnnotationFollowUpResults(managed.messages, request.id, answer, capture)
    request.annotationFollowUps![0]!.userResolvedAt = 4
    managed.messages[0]!.content = 'Externally edited'
    ;(manager as any).sessions.set(managed.id, managed)
    expect(await manager.getBodyFeedbackDetails('s', 'answer', 'note')).toMatchObject([{ instruction: 'Revise', original: 'Original answer', result: { messageId: 'result', content: answer.content, salvaged: true }, userResolvedAt: 4 }])
    writeFileSync(join(getSessionPath(root, 's'), 'data', 'body-feedback-versions', `${request.annotationFollowUps![0]!.resultContentHash}.json`), JSON.stringify('Damaged'))
    await expect(manager.getBodyFeedbackDetails('s', 'answer', 'note')).rejects.toThrow('damaged')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('user confirmation is persisted against the exact delivered revision and survives a later feedback request', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { SessionManager, createManagedSession } = await import('../sessions/SessionManager')
  const { loadSession } = await import('@craft-agent/shared/sessions')
  const root = mkdtempSync(join(tmpdir(), 'feedback-confirm-'))
  try {
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 's' }, { id: 'w', name: 'w', rootPath: root } as never, { messagesLoaded: true })
    const request: Message = { id: 'request', role: 'user', content: 'Revise', timestamp: 2 }
    managed.messages = fixture()
    prepareAnnotationFollowUps(managed.messages, [{ messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }])('request', request)
    const answer: Message = { id: 'result', role: 'assistant', content: 'Revised', timestamp: 3, answerCommitted: true, answerRunId: 'run' }
    managed.messages.push(request, answer)
    linkAnnotationFollowUpResults(managed.messages, request.id, answer)
    ;(manager as any).sessions.set(managed.id, managed)
    const annotation = managed.messages[0]!.annotations![0]!
    const followUp = annotation.meta!.followUp as Record<string, unknown>
    expect(() => manager.updateMessageAnnotation('s', 'answer', 'note', { meta: { ...annotation.meta,
      followUp: { ...followUp, requestMessageId: 'other', userResolved: true } } })).toThrow('Feedback changed')
    await manager.updateMessageAnnotation('s', 'answer', 'note', { meta: { ...annotation.meta, followUp: { ...followUp, userResolved: true } } })
    const saved = loadSession(root, 's')!
    expect((saved.messages[0]!.annotations![0]!.meta!.followUp as any).userResolved).toBe(true)
    expect(saved.messages.find(item => item.id === request.id)!.annotationFollowUps![0]).toMatchObject({ resultMessageId: 'result', resultAnswerRunId: 'run' })
    expect(saved.messages.find(item => item.id === request.id)!.annotationFollowUps![0]!.userResolvedAt).toBeGreaterThan(0)
    prepareAnnotationFollowUps(managed.messages, [{ messageId: 'answer', annotationId: 'note', text: 'Again', updatedAt: managed.messages[0]!.annotations![0]!.updatedAt! }])('next')
    expect((managed.messages[0]!.annotations![0]!.meta!.followUp as any).userResolved).toBeUndefined()
    expect(request.annotationFollowUps![0]!.resultMessageId).toBe('result')
    expect(request.annotationFollowUps![0]!.userResolvedAt).toBeGreaterThan(0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
const fixture = () => [{ id: 'answer', role: 'assistant', content: 'Original answer', timestamp: 1, annotations: [{ id: 'note', schemaVersion: 1, body: [], target: { source: { sessionId: 's', messageId: 'answer' }, selectors: [] }, createdAt: 1, meta: { keep: true } }] }] as Message[]
test('accepted feedback links the original annotation and immutable content hash to its request', () => {
  const messages = fixture()
  const apply = prepareAnnotationFollowUps(messages, [{ messageId: 'answer', annotationId: 'note', text: 'Revise this', updatedAt: 1 }])
  expect(messages[0]!.annotations![0]!.meta?.followUp).toBeUndefined()
  apply('request')
  expect(messages[0]!.annotations![0]!.meta).toMatchObject({ keep: true, followUp: { requestMessageId: 'request', text: 'Revise this', lastSentText: 'Revise this' } })
  expect((messages[0]!.annotations![0]!.meta?.followUp as any).baseContentHash).toMatch(/^[a-f0-9]{64}$/)
  expect(messages[0]!.content).toBe('Original answer')
})
test('stale or missing references reject the entire batch without marking any annotation sent', () => {
  const messages = fixture()
  const valid = { messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }
  for (const invalid of [{ ...valid, updatedAt: 2 }, { ...valid, annotationId: 'missing' }]) {
    expect(() => prepareAnnotationFollowUps(messages, [valid, invalid])).toThrow()
    expect(messages[0]!.annotations![0]!.meta?.followUp).toBeUndefined()
  }
})

test('only committed answers link results and persistence rollback restores the prior annotation', () => {
  const messages = fixture()
  prepareAnnotationFollowUps(messages, [{ messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }])('request')
  const result = { id: 'revision', role: 'assistant', content: 'Revised', timestamp: 2, answerRunId: 'run' } as Message
  linkAnnotationFollowUpResults(messages, 'request', result)
  expect((messages[0]!.annotations![0]!.meta?.followUp as any).resultMessageId).toBeUndefined()
  const rollback = linkAnnotationFollowUpResults(messages, 'request', { ...result, answerCommitted: true, answerSalvaged: true })
  expect(messages[0]!.annotations![0]!.meta?.followUp).toMatchObject({ resultMessageId: 'revision', resultAnswerRunId: 'run', resultSalvaged: true })
  rollback()
  expect((messages[0]!.annotations![0]!.meta?.followUp as any).resultMessageId).toBeUndefined()
  messages[0]!.content = 'Changed original'
  linkAnnotationFollowUpResults(messages, 'request', { ...result, answerCommitted: true })
  expect((messages[0]!.annotations![0]!.meta?.followUp as any).resultMessageId).toBeUndefined()
})

test('a new feedback request clears the previous revision identity', () => {
  const messages = fixture()
  const reference = { messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }
  prepareAnnotationFollowUps(messages, [reference])('first-request')
  linkAnnotationFollowUpResults(messages, 'first-request', {
    id: 'first-result', role: 'assistant', content: 'Revision', timestamp: 2,
    answerCommitted: true, answerRunId: 'first-run', answerSalvaged: true,
  })
  prepareAnnotationFollowUps(messages, [{ ...reference, text: 'Revise again' }])('second-request')
  expect(messages[0]!.annotations![0]!.meta?.followUp).toMatchObject({ requestMessageId: 'second-request' })
  for (const field of ['resultMessageId', 'resultAnswerRunId', 'resultSalvaged']) {
    expect((messages[0]!.annotations![0]!.meta?.followUp as Record<string, unknown>)[field]).toBeUndefined()
  }
})

test('acceptance rollback restores prior metadata without undoing a newer edit', () => {
  const messages = fixture()
  const apply = prepareAnnotationFollowUps(messages, [{ messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }])
  const rollback = apply('request')
  rollback()
  expect(messages[0]!.annotations![0]!.meta).toEqual({ keep: true })
  const rollbackOld = apply('older-request')
  const newMeta = { keep: true, followUp: { text: 'New edit' } }
  messages[0]!.annotations![0]!.meta = newMeta
  rollbackOld()
  expect(messages[0]!.annotations![0]!.meta).toBe(newMeta)
})

test('content version changes reject feedback even when the selected quote and annotation timestamp are unchanged', () => {
  const messages = fixture()
  const annotation = messages[0]!.annotations![0]!
  annotation.meta = { ...annotation.meta, sourceContentHash: assertAnnotationSource(messages[0]!.content, annotation) }
  messages[0]!.content += '\nAdded surrounding text'
  expect(() => prepareAnnotationFollowUps(messages, [{ messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }]))
    .toThrow('Annotation source changed')
  expect(annotation.meta?.followUp).toBeUndefined()
})

test('source identity keeps Markdown, Unicode and line endings verbatim', () => {
  const annotation = fixture()[0]!.annotations![0]!
  const content = '# 标题\r\n**正文** 😀\n```ts\nconst x = 1\n```'
  const hash = assertAnnotationSource(content, annotation)
  annotation.meta = { sourceContentHash: hash }
  expect(assertAnnotationSource(content, annotation)).toBe(hash)
  expect(() => assertAnnotationSource(content.replaceAll('\r\n', '\n'), annotation)).toThrow('Annotation source changed')
  annotation.meta = { sourceContentHash: 1 }
  expect(() => assertAnnotationSource(content, annotation)).toThrow('Annotation source changed')
})

test('accepted requests snapshot the target and source identity independently of subsequent edits', () => {
  const messages = fixture()
  const original = messages[0]!.annotations![0]!
  original.target.selectors = [{ type: 'text-position', start: 0, end: 8 }, { type: 'text-quote', exact: 'Original' }]
  const accepted: Message = { id: 'request', role: 'user', content: 'Revise', timestamp: 2 }
  prepareAnnotationFollowUps(messages, [{ messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }])('request', accepted)
  expect(accepted.annotationFollowUps![0]!.sourceContentHash).toMatch(/^[a-f0-9]{64}$/)
  expect(accepted.annotationFollowUps![0]!.target?.selectors[1]).toMatchObject({ exact: 'Original' })
  original.target.selectors = [{ type: 'text-quote', exact: 'New selection' }]
  original.target.source.messageId = 'different'
  expect(accepted.annotationFollowUps![0]!.target?.source.messageId).toBe('answer')
  expect(accepted.annotationFollowUps![0]!.target?.selectors[1]).toMatchObject({ exact: 'Original' })
})

test('feedback status follows its request and cannot overwrite delivery or a newer request', () => {
  const messages = fixture()
  const apply = prepareAnnotationFollowUps(messages, [{ messageId: 'answer', annotationId: 'note', text: 'Revise', updatedAt: 1 }])
  apply('request')
  expect(messages[0]!.annotations![0]!.meta?.followUp).toMatchObject({ status: 'queued' })
  expect(setAnnotationFeedbackStatus(messages, 'request', 'running')).toHaveLength(1)
  expect(messages[0]!.annotations![0]!.meta?.followUp).toMatchObject({ status: 'running' })
  expect(setAnnotationFeedbackStatus(messages, 'request', 'running')).toHaveLength(0)
  linkAnnotationFollowUpResults(messages, 'request', { id: 'result', role: 'assistant', content: 'Revision', timestamp: 2, answerCommitted: true })
  expect(setAnnotationFeedbackStatus(messages, 'request', 'failed')).toHaveLength(0)
  expect(messages[0]!.annotations![0]!.meta?.followUp).toMatchObject({ status: 'delivered' })
  apply('new-request')
  expect(setAnnotationFeedbackStatus(messages, 'request', 'interrupted')).toHaveLength(0)
  expect(messages[0]!.annotations![0]!.meta?.followUp).toMatchObject({ status: 'queued', requestMessageId: 'new-request' })
})
