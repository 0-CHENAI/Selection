import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProject } from '@craft-agent/shared/projects'
import { getSessionPath, loadSession } from '@craft-agent/shared/sessions'
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

  const sandbox = await createSession(root, {
    name: 'sandbox',
    projectId: project.id,
    workingDirectory: first,
  })
  const isolationDir = join(getSessionPath(root, sandbox.id), 'data')
  mkdirSync(isolationDir, { recursive: true })
  writeFileSync(join(isolationDir, 'isolated-workspace.json'), JSON.stringify({ version: 1, directory: first }))
  const liveOnDisk = await createSession(root, {
    name: 'live-sandbox',
    projectId: project.id,
    workingDirectory: first,
  })
  const liveSandbox = createManagedSession({
    id: liveOnDisk.id,
    projectId: project.id,
    workingDirectory: first,
    sdkCwd: first,
    sdkSessionId: 'sdk-sandbox',
    messages: [],
  }, workspace as never, { messagesLoaded: true })
  // The on-disk header has no isolation flag. The loaded session does.
  ;(liveSandbox as { isolatedWorkspace?: { version: number } }).isolatedWorkspace = { version: 1 }
  internal.sessions.set(liveOnDisk.id, liveSandbox)

  await manager.alignProjectConversationDirectories(workspace.id, project.id, next)

  const conversation = loadSession(root, stored.id)
  expect(conversation?.workingDirectory).toBe(next)
  expect(conversation?.sdkCwd).toBe(first)
  expect(loadSession(root, worker.id)?.workingDirectory).toBe(first)
  expect(loadSession(root, sandbox.id)?.workingDirectory).toBe(first)
  expect(liveSandbox.workingDirectory).toBe(first)
  expect(liveSandbox.sdkCwd).toBe(first)
})

test('binding a session to a project moves it onto the project folder without moving sdkCwd', async () => {
  const root = mkdtempSync(join(tmpdir(), 'project-bind-'))
  roots.push(root)
  const projectFolder = join(root, '项目')
  const previous = join(root, 'previous')
  mkdirSync(projectFolder)
  mkdirSync(previous)
  const project = createProject(root, { name: '巡察', workingDirectory: projectFolder })
  const workspace = { id: 'workspace', name: 'Workspace', slug: 'workspace', rootPath: root, createdAt: 1 }
  const manager = new SessionManager()
  const { createSession, updateSessionSdkId } = await import('@craft-agent/shared/sessions')
  const stored = await createSession(root, { name: '迁入', workingDirectory: previous })
  await updateSessionSdkId(root, stored.id, 'kept')
  const conversation = createManagedSession({
    id: stored.id,
    workingDirectory: previous,
    sdkCwd: previous,
    sdkSessionId: 'kept',
    messages: [{ id: 'm', role: 'user', content: 'hello', timestamp: 1 }],
  }, workspace as never, { messagesLoaded: true })
  const worker = createManagedSession({
    id: 'worker',
    orchestrationRole: 'worker',
    workingDirectory: previous,
    messages: [],
  }, workspace as never, { messagesLoaded: true })
  const internal = manager as unknown as { sessions: Map<string, unknown> }
  internal.sessions.set(stored.id, conversation)
  internal.sessions.set('worker', worker)

  await manager.setSessionProjectId(stored.id, project.id)
  await manager.setSessionProjectId('worker', project.id)

  expect(conversation.workingDirectory).toBe(projectFolder)
  expect(conversation.sdkCwd).toBe(previous)
  expect(loadSession(root, stored.id)?.workingDirectory).toBe(projectFolder)
  expect(loadSession(root, stored.id)?.sdkCwd).toBe(previous)
  expect(worker.workingDirectory).toBe(previous)
})
