import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSessionPath, listSessions, loadSession } from '@craft-agent/shared/sessions/storage'
import type { PptRequest } from '@craft-agent/shared/protocol'
import { createManagedSession, SessionManager } from './SessionManager'

test('manager persistence and restored renderer list/detail preserve PPT metadata and queued turn settings', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'manager-ppt-')))
  try {
    const workspace = { id: 'ppt-ws', slug: 'ppt-workspace', name: 'PPT', rootPath: root, createdAt: Date.now() }
    const ppt: PptRequest = { templateId: 'dsh-cartesian', brandColor: '#123456', logo: { name: 'logo.png', mimeType: 'image/png', base64: Buffer.alloc(24 * 1024, 97).toString('base64') } }
    const managed = createManagedSession({ id: 'ppt-persist', workMode: 'PRO', ppt, createdAt: Date.now() }, workspace, { messagesLoaded: true })
    managed.messages.push({ id: 'queued', role: 'user', content: '保留原始要求', timestamp: Date.now(), isQueued: true, turnContext: { ppt } })
    mkdirSync(getSessionPath(root, managed.id), { recursive: true })
    const manager = new SessionManager()
    const internals = manager as unknown as { sessions: Map<string, typeof managed>; persistSession: (session: typeof managed) => void }
    internals.sessions.set(managed.id, managed)
    expect(manager.getSessions(workspace.id)[0]?.ppt).toEqual(ppt)
    internals.persistSession(managed)
    await manager.flushSession(managed.id)
    expect(loadSession(root, managed.id)?.ppt).toEqual(ppt)
    expect(loadSession(root, managed.id)?.messages[0]?.turnContext?.ppt).toEqual(ppt)
    const metadata = listSessions(root).find(item => item.id === managed.id)!
    const restored = createManagedSession(metadata, workspace)
    // Keep restored work active so lazy queue recovery cannot launch an unrelated model process.
    restored.isProcessing = true
    const restarted = new SessionManager()
    // Tests install restored metadata without global workspace/auth initialization.
    const restartedInternals = restarted as unknown as { sessions: Map<string, typeof restored> }
    restartedInternals.sessions.set(restored.id, restored)
    expect(restarted.getSessions(workspace.id)[0]?.ppt).toEqual(ppt)
    expect((await restarted.getSession(restored.id))?.ppt).toEqual(ppt)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
