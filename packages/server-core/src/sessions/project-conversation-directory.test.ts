import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProject } from '@craft-agent/shared/projects'
import { loadSession } from '@craft-agent/shared/sessions'
import { createManagedSession, SessionManager } from './SessionManager'

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

test('a project conversation follows the project folder and keeps its transcript location', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-cwd-'))
  roots.push(root)
  const projectFolder = join(root, '巡察资料')
  const otherFolder = join(root, 'other')
  mkdirSync(projectFolder)
  mkdirSync(otherFolder)
  const project = createProject(root, { name: '巡察', workingDirectory: projectFolder })
  const workspace = { id: 'workspace', name: 'Workspace', slug: 'workspace', rootPath: root, createdAt: 1 }
  const manager = new SessionManager()
  const conversation = createManagedSession({
    id: 'chat',
    projectId: project.id,
    workingDirectory: otherFolder,
    sdkCwd: otherFolder,
    sdkSessionId: 'sdk-chat',
    messages: [],
  }, workspace as never, { messagesLoaded: true })
  const worker = createManagedSession({
    id: 'worker',
    projectId: project.id,
    orchestrationRole: 'worker',
    workingDirectory: otherFolder,
    messages: [],
  }, workspace as never, { messagesLoaded: true })
  const plain = createManagedSession({
    id: 'plain',
    workingDirectory: projectFolder,
    messages: [],
  }, workspace as never, { messagesLoaded: true })
  const internal = manager as unknown as { sessions: Map<string, unknown> }
  internal.sessions.set('chat', conversation)
  internal.sessions.set('worker', worker)
  internal.sessions.set('plain', plain)

  manager.updateWorkingDirectory('chat', otherFolder)
  expect(conversation.workingDirectory).toBe(projectFolder)
  expect(conversation.sdkCwd).toBe(otherFolder)

  manager.updateWorkingDirectory('worker', otherFolder)
  expect(worker.workingDirectory).toBe(otherFolder)

  manager.updateWorkingDirectory('plain', otherFolder)
  expect(plain.workingDirectory).toBe(otherFolder)
})

test('changing the project folder rewrites stored project conversations only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'project-cwd-disk-'))
  roots.push(root)
  const first = join(root, 'first')
  const next = join(root, 'next')
  mkdirSync(first)
  mkdirSync(next)
  const project = createProject(root, { name: '巡察', workingDirectory: first })
  const workspace = { id: 'workspace', name: 'Workspace', slug: 'workspace', rootPath: root, createdAt: 1 }
  const manager = new SessionManager()
  const internal = manager as unknown as {
    sessions: Map<string, unknown>
    getWorkspaces: () => unknown[]
  }
  internal.getWorkspaces = () => [workspace]
  const { createSession, updateSessionSdkId } = await import('@craft-agent/shared/sessions')
  const stored = await createSession(root, { name: '已有会话', projectId: project.id, workingDirectory: first })
  await updateSessionSdkId(root, stored.id, 'kept')
  const worker = await createSession(root, {
    name: 'worker',
    projectId: project.id,
    workingDirectory: first,
    orchestrationRole: 'worker',
  })

  await manager.alignProjectConversationDirectories(workspace.id, project.id, next)

  const conversation = loadSession(root, stored.id)
  expect(conversation?.workingDirectory).toBe(next)
  expect(conversation?.sdkCwd).toBe(first)
  expect(loadSession(root, worker.id)?.workingDirectory).toBe(first)
})
