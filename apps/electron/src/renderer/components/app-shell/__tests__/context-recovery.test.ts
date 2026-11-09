import { expect, test, mock } from 'bun:test'
import { contextRecoverySource, prepareContextRecoveryDraft } from '../context-recovery'
import type { Session, Message } from '../../../../shared/types'

const source: Message = { id: 'u', role: 'user', content: '# 中文\r\n```ts\nconst x = 1\n```\n[file](E:/文件/a.txt)', timestamp: 1,
  attachments: [{ id: 'a', type: 'text', name: '源 文件.txt', mimeType: 'text/plain', size: 2, storedPath: 'E:\\项目\\源 文件.txt' },
    { id: 'b', type: 'text', name: 'share.txt', mimeType: 'text/plain', size: 2, storedPath: '\\\\host\\共享\\share.txt' }] }
const error: Message = { id: 'e', role: 'error', content: 'context limit', errorCode: 'context_limit', timestamp: 2 }
const session: Session = { id: 's', workspaceId: 'w', workspaceName: 'Workspace', lastMessageAt: 2, name: 'task', messages: [source, error], isProcessing: false,
  model: 'model', llmConnection: 'connection', permissionMode: 'safe', workingDirectory: 'E:\\项目', enabledSourceSlugs: ['source'], projectId: 'project' }

test('only the current context-limit failure binds to its visible user request', () => {
  expect(contextRecoverySource([source, { ...source, id: 'hidden', hidden: true }, error], 'e')).toBe(source)
  expect(contextRecoverySource([source, error, { ...source, id: 'queued', isQueued: true }], 'e')).toBe(source)
  expect(contextRecoverySource([source, error, { ...source, id: 'new' }], 'e')).toBeUndefined()
  const latestError = { ...error, id: 'latest' }
  expect(contextRecoverySource([source, error, latestError], 'e')).toBeUndefined()
  expect(contextRecoverySource([source, error, latestError], 'latest')).toBe(source)
  expect(contextRecoverySource([source, error, { id: 'answer', role: 'assistant', content: 'done', timestamp: 3, answerCommitted: true }], 'e')).toBeUndefined()
  expect(contextRecoverySource([source, { ...error, errorCode: 'unknown_error' }], 'e')).toBeUndefined()
  expect(contextRecoverySource([error], 'e')).toBeUndefined()
})

test('new draft keeps exact input, stored cross-drive/UNC paths, and session scope without sending or mutating history', async () => {
  const original = structuredClone(session)
  const bigSource = { ...source, content: source.content + '文'.repeat(100_000) }
  const child = { ...session, id: 'child', messages: [] }
  const createSession = mock(async () => child)
  const saveDraft = mock(async () => {})
  const statPath = mock(async () => ({ type: 'file' }))
  expect(await prepareContextRecoveryDraft(session, bigSource, { statPath, createSession, saveDraft })).toBe(child)
  expect(createSession).toHaveBeenCalledWith('w', { llmConnection: 'connection', model: 'model', permissionMode: 'safe',
    workingDirectory: 'E:\\项目', enabledSourceSlugs: ['source'], projectId: 'project' })
  expect(saveDraft).toHaveBeenCalledWith('child', { text: bigSource.content, attachments: source.attachments!.map(attachment => ({ path: attachment.storedPath, name: attachment.name })) })
  expect(statPath).toHaveBeenCalledTimes(2)
  expect(session).toEqual(original)
})

test('missing source attachments and failed draft saves cannot report a ready draft', async () => {
  const createSession = mock(async () => ({ ...session, id: 'child' }))
  const saveDraft = mock(async () => {})
  await expect(prepareContextRecoveryDraft(session, source, { statPath: async () => null, createSession, saveDraft })).rejects.toThrow('Attachment is unavailable')
  expect(createSession).not.toHaveBeenCalled(); expect(saveDraft).not.toHaveBeenCalled()
  await expect(prepareContextRecoveryDraft(session, source, { statPath: async () => ({ type: 'file' }), createSession,
    saveDraft: async () => { throw new Error('disk failed') } })).rejects.toThrow('disk failed')
  expect(session.messages).toEqual([source, error])
})
