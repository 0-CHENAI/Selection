import { afterEach, expect, it, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { storedToMessage } from '@craft-agent/core/types'
import { createSession, loadSession, saveSession, sessionPersistenceQueue } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it.each([false, true])('returns and persists branch history with source messages loaded=%s', async (messagesLoaded) => {
  const root = await mkdtemp(join(tmpdir(), 'branch-history-'))
  roots.push(root)
  const workspace = { id: 'branch-workspace', name: 'Workspace', slug: 'workspace', rootPath: root, createdAt: Date.now() }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace)
  const manager = new SessionManager()
  const created = await createSession(root)
  const source = loadSession(root, created.id)!
  source.sdkSessionId = 'source-sdk'
  source.messages = [
    { id: 'question', type: 'user', content: '请记住分支之前的上下文', timestamp: 1 },
    { id: 'answer', type: 'assistant', content: '已记录上下文', timestamp: 2 },
    { id: 'later', type: 'user', content: '分支之后的内容', timestamp: 3 },
  ]
  await saveSession(source)
  const { messages: sourceMessages, ...metadata } = source
  const managed = createManagedSession(metadata, workspace, messagesLoaded ? {
    messagesLoaded: true,
    messages: sourceMessages.map(storedToMessage),
  } : undefined)
  ;(manager as any).sessions.set(source.id, managed)
  ;(manager as any).getOrCreateAgent = async (child: any) => {
    child.agent = { ensureBranchReady: async () => {
      expect(child.messages.map((message: { id: string }) => message.id)).toEqual(['question', 'answer'])
    } }
    return child.agent
  }
  try {
    const branch = await manager.createSession(workspace.id, {
      branchFromSessionId: source.id, branchFromMessageId: 'answer',
    })
    expect(branch.messages.map(message => message.id)).toEqual(['question', 'answer'])
    expect((await manager.getSession(branch.id))?.messages.map(message => message.id)).toEqual(['question', 'answer'])
    expect(loadSession(root, branch.id)?.messages.map(message => message.id)).toEqual(['question', 'answer'])
    expect(loadSession(root, branch.id)?.workspaceRootPath).toBe(root)
    ;(manager as any).sessions.get(branch.id).messagesLoaded = false
    ;(manager as any).sessions.get(branch.id).messages = []
    expect((await manager.getSession(branch.id))?.messages.map(message => message.id)).toEqual(['question', 'answer'])
    await manager.flushSession(branch.id)
    sessionPersistenceQueue.cancel(branch.id)
  } finally {
    lookup.mockRestore()
    await manager.flushSession(source.id)
    sessionPersistenceQueue.cancel(source.id)
  }
})
