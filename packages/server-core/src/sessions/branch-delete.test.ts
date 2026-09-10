import { afterEach, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, getSessionPath, loadSession, saveSession } from '@craft-agent/shared/sessions'
import { createManagedSession, SessionManager } from './SessionManager'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it('preserves a cold legacy branch before deleting its source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'branch-delete-'))
  roots.push(root)
  const source = await createSession(root)
  const branch = await createSession(root)
  const sourceDir = getSessionPath(root, source.id)
  const branchDir = getSessionPath(root, branch.id)
  await mkdir(join(sourceDir, '.pi-sessions'))
  await writeFile(join(sourceDir, '.pi-sessions', 'history.jsonl'), '{"id":"anchor"}\n')
  await writeFile(join(sourceDir, 'attachments', 'proof.txt'), 'original attachment')
  const stored = loadSession(root, branch.id)!
  stored.branchFromMessageId = 'answer'
  stored.branchFromSessionPath = sourceDir
  stored.messages = [{ id: 'answer', type: 'assistant', content: 'retained answer', timestamp: 1 }]
  await saveSession(stored)
  const manager = new SessionManager()
  const workspace = { id: 'workspace', slug: 'workspace', name: 'Workspace', rootPath: root, createdAt: Date.now() }
  const managed = createManagedSession(source, workspace)
  ;(manager as any).sessions.set(source.id, managed)
  await manager.deleteSession(source.id)
  expect(existsSync(sourceDir)).toBe(false)
  const restored = loadSession(root, branch.id)!
  expect(restored.messages[0]?.content).toBe('retained answer')
  expect(restored.branchFromSessionPath).toBe(join(branchDir, '.branch-source'))
  expect(await readFile(join(branchDir, 'attachments', 'proof.txt'), 'utf8')).toBe('original attachment')
  expect(existsSync(join(restored.branchFromSessionPath!, '.pi-sessions', 'history.jsonl'))).toBe(true)
})

it('deletes disk-only and empty sessions while preserving unrelated directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'disk-delete-'))
  roots.push(root)
  const source = await createSession(root)
  const other = await createSession(root)
  const manager = new SessionManager()
  manager.getWorkspaces = () => [{ id: 'workspace', slug: 'workspace', name: 'Workspace', rootPath: root, createdAt: Date.now() }]
  await manager.deleteSession(source.id)
  expect(existsSync(getSessionPath(root, source.id))).toBe(false)
  expect(loadSession(root, source.id)).toBeNull()
  expect(existsSync(getSessionPath(root, other.id))).toBe(true)
  await manager.deleteSession(source.id) // deletion is idempotent
})

it('does not recreate a deleted session from a late event or persistence callback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'late-delete-'))
  roots.push(root)
  const source = await createSession(root)
  const manager = new SessionManager()
  const workspace = { id: 'workspace', slug: 'workspace', name: 'Workspace', rootPath: root, createdAt: Date.now() }
  const managed = createManagedSession(source, workspace, { messagesLoaded: true })
  ;(manager as any).sessions.set(source.id, managed)
  ;(manager as any).persistSession(managed)
  await manager.deleteSession(source.id)
  await (manager as any).processEvent(managed, { type: 'text_complete', text: 'late text' })
  ;(manager as any).persistSession(managed)
  await manager.flushSession(source.id)
  expect(existsSync(getSessionPath(root, source.id))).toBe(false)
})

it('waits for in-flight runtime initialization before deleting files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'init-delete-'))
  roots.push(root)
  const source = await createSession(root)
  const manager = new SessionManager()
  const managed = createManagedSession(source, { id: 'workspace', slug: 'workspace', name: 'Workspace', rootPath: root, createdAt: Date.now() })
  ;(manager as any).sessions.set(source.id, managed)
  let release!: () => void
  managed.agentCreation = new Promise(resolve => { release = () => resolve(null as never) })
  let finished = false
  const deletion = manager.deleteSession(source.id).then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  await writeFile(join(getSessionPath(root, source.id), 'late-init-artifact'), 'runtime setup')
  release()
  await deletion
  expect(existsSync(getSessionPath(root, source.id))).toBe(false)
})

it('preserves the directory when runtime shutdown fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'failed-delete-'))
  roots.push(root)
  const source = await createSession(root)
  const manager = new SessionManager()
  const managed = createManagedSession(source, { id: 'workspace', slug: 'workspace', name: 'Workspace', rootPath: root, createdAt: Date.now() })
  managed.agent = { disposeForRestart: async () => { throw new Error('shutdown failed') } } as any
  ;(manager as any).sessions.set(source.id, managed)
  await expect(manager.deleteSession(source.id)).rejects.toThrow('directory was preserved')
  expect(existsSync(getSessionPath(root, source.id))).toBe(true)
  expect(managed.deleting).toBe(false)
  expect((manager as any).sessions.get(source.id)).toBe(managed)
})

it('archives without removing the session directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archive-preserve-'))
  roots.push(root)
  const source = await createSession(root)
  const manager = new SessionManager()
  const managed = createManagedSession(source, { id: 'workspace', slug: 'workspace', name: 'Workspace', rootPath: root, createdAt: Date.now() })
  ;(manager as any).sessions.set(source.id, managed)
  await manager.archiveSession(source.id)
  expect(existsSync(getSessionPath(root, source.id))).toBe(true)
  expect(loadSession(root, source.id)?.isArchived).toBe(true)
})
