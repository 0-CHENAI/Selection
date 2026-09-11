import { afterEach, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { createProject, loadProject } from '@craft-agent/shared/projects'
import { createSession, loadSession, saveSession, listSessions } from '@craft-agent/shared/sessions'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { createManagedSession, SessionManager } from '../../sessions/SessionManager'
import { registerProjectsHandlers } from './projects'
import type { RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

const roots: string[] = []
const spies: Array<{ mockRestore(): void }> = []
afterEach(() => {
  spies.splice(0).forEach(spy => spy.mockRestore())
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'project-delete-'))
  roots.push(root)
  const workspace = { id: 'workspace', name: 'Workspace', slug: 'workspace', rootPath: root, createdAt: Date.now() }
  spies.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace))
  const manager = new SessionManager()
  manager.getWorkspaces = () => [workspace]
  manager.waitForInit = async () => {}
  const events: unknown[] = []
  manager.setEventSink((...args) => { events.push(args) })
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  registerProjectsHandlers({
    handle: (name: string, fn: (...args: any[]) => Promise<any>) => handlers.set(name, fn),
    push: (...args: unknown[]) => events.push(args),
  } as unknown as RpcServer, {
    sessionManager: manager,
    platform: { logger: { info() {}, warn() {}, error() {} } },
  } as unknown as HandlerDeps)
  const project = createProject(root, { name: 'Delete me' })
  async function session(projectId?: string, live = false) {
    const created = await createSession(root)
    const stored = loadSession(root, created.id)!
    stored.projectId = projectId
    await saveSession(stored)
    if (live) (manager as any).sessions.set(stored.id, createManagedSession({ id: stored.id, projectId }, workspace))
    return stored
  }
  return { root, workspace, manager, project, events, session,
    remove: () => handlers.get(RPC_CHANNELS.projects.DELETE)!({}, workspace.id, project.slug) }
}

it('deletes live and disk-only project sessions, broadcasts deletion, and preserves unrelated sessions', async () => {
  const app = setup()
  const live = await app.session(app.project.id, true)
  const cold = await app.session(app.project.id)
  const other = await app.session('other-project', true)
  const ordinary = await app.session()
  await app.remove()
  expect(loadProject(app.root, app.project.slug)).toBeNull()
  expect(loadSession(app.root, live.id)).toBeNull()
  expect(loadSession(app.root, cold.id)).toBeNull()
  expect(listSessions(app.root).map(s => s.id).sort()).toEqual([other.id, ordinary.id].sort())
  expect(app.manager.getSessions(app.workspace.id).map(s => s.id)).toEqual([other.id])
  for (const id of [live.id, cold.id]) {
    expect(app.events.some(args => JSON.stringify(args).includes(JSON.stringify({ type: 'session_deleted', sessionId: id })))).toBe(true)
  }
  await app.remove() // Missing project is an idempotent no-op.
})

it('uses live project membership when disk metadata has not caught up', async () => {
  const app = setup()
  const movedOut = await app.session(app.project.id, true)
  const movedIn = await app.session(undefined, true)
  ;(app.manager as any).sessions.get(movedOut.id).projectId = undefined
  ;(app.manager as any).sessions.get(movedIn.id).projectId = app.project.id
  await app.remove()
  expect(loadSession(app.root, movedOut.id)).not.toBeNull()
  expect(loadSession(app.root, movedIn.id)).toBeNull()
})

it('retains the project and session association when cleanup fails, allowing retry', async () => {
  const app = setup()
  const session = await app.session(app.project.id)
  const failure = spyOn(app.manager, 'deleteSession').mockRejectedValue(new Error('cleanup failed'))
  spies.push(failure)
  await expect(app.remove()).rejects.toThrow('cleanup failed')
  expect(loadProject(app.root, app.project.slug)).not.toBeNull()
  expect(loadSession(app.root, session.id)?.projectId).toBe(app.project.id)
  failure.mockRestore()
  await app.remove()
  expect(loadSession(app.root, session.id)).toBeNull()
})
