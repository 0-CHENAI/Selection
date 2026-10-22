import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Keep configuration and persistence entirely inside this disposable fixture.
const configRoot = mkdtempSync(join(tmpdir(), 'ordinary-context-config-'))
const previousConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = configRoot
const config = await import('@craft-agent/shared/config')
expect(config.CONFIG_DIR).toBe(configRoot)
config.ensureConfigDir()
const { saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
const { createProject } = await import('@craft-agent/shared/projects')
const { createSession, loadSession, getSessionPath } = await import('@craft-agent/shared/sessions')
const { SessionManager, createManagedSession, buildAgentSessionConfig } = await import('./SessionManager')

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir
  rmSync(configRoot, { recursive: true, force: true })
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ordinary-context-'))
  const folder = join(root, 'chosen')
  mkdirSync(folder)
  const workspace = { id: 'ws', slug: 'ws', name: 'Workspace', rootPath: root, createdAt: 1 }
  saveWorkspaceConfig(root, { ...workspace, updatedAt: 1,
    defaults: { workingDirectory: folder, enabledSourceSlugs: ['workspace-default'], model: 'gpt-6-luna' } })
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace)
  const manager = new SessionManager()
  const sessions = (manager as unknown as { sessions: Map<string, ReturnType<typeof createManagedSession>> }).sessions
  cleanups.push(async () => {
    await manager.flushAllSessions()
    for (const session of sessions.values()) session.agent = null
    manager.cleanup()
    lookup.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, folder, workspace, manager, sessions }
}

test.each([false, true])('ordinary folder reset persists through cold restore and updates tools (loaded=%s)', async messagesLoaded => {
  const { root, folder, workspace, manager, sessions } = fixture()
  const stored = await createSession(root, { workingDirectory: folder, enabledSourceSlugs: ['kept'] })
  const managed = createManagedSession(stored, workspace, { messagesLoaded,
    sdkSessionId: 'existing-transcript', sdkCwd: folder })
  const updates: string[] = []
  managed.agent = { updateWorkingDirectory: (path: string) => updates.push(path) } as never
  sessions.set(stored.id, managed)
  const events: unknown[] = []
  manager.setEventSink((_channel, _target, ...payload) => { events.push(...payload) })

  manager.updateWorkingDirectory(stored.id, 'none')
  await manager.flushSession(stored.id)
  const sessionRoot = getSessionPath(root, stored.id)
  expect(managed.workingDirectory).toBe(sessionRoot)
  expect(buildAgentSessionConfig(managed).workingDirectory).toBe(sessionRoot)
  expect(updates).toEqual([sessionRoot])
  expect(events).toContainEqual({ type: 'working_directory_changed', sessionId: stored.id, workingDirectory: sessionRoot })
  expect(managed.sdkCwd).toBe(folder)
  const restored = loadSession(root, stored.id)!
  expect(restored.workingDirectory).toBe(sessionRoot)
  expect(restored.enabledSourceSlugs).toEqual(['kept'])
  sessions.set(stored.id, createManagedSession(restored, workspace))
  expect((await manager.getSession(stored.id))?.workingDirectory).toBe(sessionRoot)
  // Ordinary sessions still support selecting a folder again.
  manager.updateWorkingDirectory(stored.id, folder)
  expect(sessions.get(stored.id)?.workingDirectory).toBe(folder)
})

test('fresh ordinary sessions ignore source defaults; existing selections survive switching, refresh and lazy restore', async () => {
  const { root, workspace, manager, sessions } = fixture()
  const a = await manager.createSession(workspace.id, { enabledSourceSlugs: ['chosen'], model: 'gpt-6-luna' })
  const b = await manager.createSession(workspace.id)
  expect(a.enabledSourceSlugs).toEqual(['chosen'])
  expect(b.enabledSourceSlugs).toEqual([])
  expect(b.model).toBe('gpt-6-luna')
  expect((await manager.getSession(a.id))?.enabledSourceSlugs).toEqual(['chosen'])
  expect((await manager.getSession(b.id))?.enabledSourceSlugs).toEqual([])
  await manager.flushAllSessions()
  for (const id of [a.id, b.id]) {
    const restored = loadSession(root, id)!
    sessions.set(id, createManagedSession(restored, workspace))
  }
  expect((await manager.getSession(b.id))?.enabledSourceSlugs).toEqual([])
  expect((await manager.getSession(a.id))?.enabledSourceSlugs).toEqual(['chosen'])
  expect(manager.getSessions(workspace.id).find(item => item.id === a.id)?.enabledSourceSlugs).toEqual(['chosen'])
  // Clearing one session must not clear another or the workspace configuration.
  await manager.setSessionSources(b.id, [])
  expect(manager.getSessionSources(a.id)).toEqual(['chosen'])
})

test('a draft directory opt-out survives refresh even when a workspace default exists', async () => {
  const { root, workspace, manager } = fixture()
  const created = await manager.createSession(workspace.id, { workingDirectory: 'none' })
  const sessionRoot = getSessionPath(root, created.id)
  expect(created.workingDirectory).toBe(sessionRoot)
  await manager.flushSession(created.id)
  expect(loadSession(root, created.id)?.workingDirectory).toBe(sessionRoot)
})

test('reset cannot clear a project binding; project defaults and transcript identity remain intact', async () => {
  const { root, folder, workspace, manager, sessions } = fixture()
  const project = createProject(root, { name: 'Project', workingDirectory: folder })
  const created = await manager.createSession(workspace.id, { projectId: project.id, workingDirectory: 'none' })
  expect(created.workingDirectory).toBe(folder)
  expect(created.enabledSourceSlugs).toEqual(['workspace-default'])
  manager.updateWorkingDirectory(created.id, 'none')
  await manager.flushSession(created.id)
  expect(sessions.get(created.id)?.projectId).toBe(project.id)
  expect(loadSession(root, created.id)?.workingDirectory).toBe(folder)
  expect(loadSession(root, created.id)?.sdkCwd).toBe(folder)
})

test('model switching and lazy restore preserve the selected thinking preference', async () => {
  const { root, workspace, manager, sessions } = fixture()
  const created = await manager.createSession(workspace.id, { model: 'gpt-6-luna', thinkingLevel: 'xhigh' })
  for (const model of ['gpt-4o', 'claude-haiku-4-5-20251001', 'gpt-6-luna']) {
    await manager.updateSessionModel(created.id, workspace.id, model)
    await manager.flushSession(created.id)
    expect(loadSession(root, created.id)?.thinkingLevel).toBe('xhigh')
  }
  const stored = loadSession(root, created.id)!
  sessions.set(created.id, createManagedSession(stored, workspace))
  expect((await manager.getSession(created.id))?.thinkingLevel).toBe('xhigh')
  expect(sessions.get(created.id)?.model).toBe('gpt-6-luna')
})
