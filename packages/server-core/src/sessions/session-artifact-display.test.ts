import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { loadSession as loadStoredSession } from '@craft-agent/shared/sessions'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { ConversationArtifactVersions } from '../reliability/conversation-artifact-versions'
import { localArtifactLinks } from '@craft-agent/shared/utils/artifact-links'
import { createManagedSession, SessionManager } from './SessionManager'

test('loading an older answer shows only files versioned by that answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-artifact-display-'))
  try {
    const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
    const original = join(root, 'original.docx')
    const revised = join(root, 'revised.docx')
    writeFileSync(original, 'original'); writeFileSync(revised, 'revised')
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const oldVersion = store.register(original, 'session/user-1').versions[0]!
    const newVersion = store.register(revised, 'session/user-2').versions[0]!
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'session' }, workspace as never, { messagesLoaded: true })
    managed.messages.push(
      { id: 'user-2', role: 'user', content: 'revise', timestamp: 1 },
      { id: 'answer-2', role: 'assistant', content: '[新版](revised.docx) [原版](original.docx)', timestamp: 2,
        artifactVersions: [
          { path: 'revised.docx', versionId: newVersion.id, ordinal: 1 },
          { path: 'original.docx', versionId: oldVersion.id, ordinal: 1 },
        ] },
    )
    ;(manager as any).sessions.set(managed.id, managed)
    const shown = await manager.getSession(managed.id)
    expect(shown?.messages[1]?.artifactVersions?.map(ref => ref.path)).toEqual(['revised.docx'])
    expect(managed.messages[1]!.artifactVersions).toHaveLength(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a new chat displays its first delivery as version 1 while shared file snapshots remain intact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-artifact-local-'))
  try {
    const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
    const file = join(root, 'report.docx')
    writeFileSync(file, 'old content')
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const old = store.register(file, 'old/user-1')
    writeFileSync(file, 'new content')
    const current = store.capture(old.id, 'new/user-1')
    const manager = new SessionManager()
    const newer = createManagedSession({ id: 'new' }, workspace as never, { messagesLoaded: true })
    newer.messages.push({ id: 'user-1', role: 'user', content: '创建文档', timestamp: 1 },
      { id: 'answer-1', role: 'assistant', content: '[文件](report.docx)', timestamp: 2,
        artifactVersions: [{ path: file, versionId: current.currentVersion, ordinal: 2, change: 'created' }] })
    ;(manager as any).sessions.set(newer.id, newer)
    const shown = await manager.getSession(newer.id)
    expect(shown?.messages[1]?.artifactVersions?.[0]).toMatchObject({ ordinal: 2, sessionOrdinal: 1 })
    expect(store.read(old.id).versions).toHaveLength(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('streamed final answers publish file versions in the live event and saved session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'streaming-artifact-display-'))
  try {
    const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'session' }, workspace as never, { messagesLoaded: true })
    managed.messages.push({ id: 'user-1', role: 'user', content: '创建报告', timestamp: Date.now() - 1000 })
    managed.conversationArtifactVersions = new ConversationArtifactVersions(
      new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id),
      [root], async path => path, () => { throw new Error('Artifact recording failed') }, Date.now() - 1000,
    )
    ;(manager as any).sessions.set(managed.id, managed)
    const events: any[] = []
    manager.setEventSink((_channel, _target, event) => events.push(event))
    writeFileSync(join(root, 'report.docx'), 'report')

    await (manager as any).processEvent(managed, {
      type: 'text_complete', text: '报告已完成。[下载](report.docx)', phase: 'unclassified', turnId: 'turn-1',
    })
    await manager.flushSession(managed.id)

    const answer = managed.messages.at(-1)!
    expect(answer.artifactVersions).toMatchObject([{ path: 'report.docx', ordinal: 1, change: 'created' }])
    expect(events.find(event => event.type === 'text_complete')?.artifactVersions).toEqual(answer.artifactVersions)
    expect(loadStoredSession(root, managed.id)?.messages.at(-1)?.artifactVersions).toEqual(answer.artifactVersions)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('streamed file versions retain bytes and can be restored through the version tool', async () => {
  const root = mkdtempSync(join(tmpdir(), 'streaming-artifact-restore-'))
  try {
    const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'session' }, workspace as never, { messagesLoaded: true })
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    manager.setEventSink(() => {})
    const file = join(root, 'report.docx')
    const tracker = () => new ConversationArtifactVersions(store, [root], async path => realpathSync(path),
      () => { throw new Error('Artifact recording failed') }, Date.now() - 1000)
    ;(manager as any).sessions.set(managed.id, managed)

    managed.messages.push({ id: 'user-1', role: 'user', content: '创建报告', timestamp: Date.now() - 1000 })
    managed.conversationArtifactVersions = tracker()
    writeFileSync(file, 'first version')
    await (manager as any).processEvent(managed, { type: 'text_complete', text: '[报告](report.docx)' })
    const firstAnswer = managed.messages.at(-1)!
    const first = store.findByPath(file)!
    expect(firstAnswer.artifactVersions).toMatchObject([{ versionId: first.currentVersion, ordinal: 1, change: 'created' }])

    managed.messages.push({ id: 'user-2', role: 'user', content: '修改报告', timestamp: Date.now() })
    managed.conversationArtifactVersions = tracker()
    await managed.conversationArtifactVersions.track(firstAnswer.content)
    writeFileSync(file, 'second version')
    await (manager as any).processEvent(managed, { type: 'text_complete', text: '[新版报告](report.docx)' })
    const secondAnswer = managed.messages.at(-1)!
    const second = store.findByPath(file)!
    expect(second.versions).toHaveLength(2)
    expect(secondAnswer.artifactVersions).toMatchObject([{ versionId: second.currentVersion, ordinal: 2, change: 'modified' }])
    expect(store.versionBytes(first.id, first.currentVersion).toString()).toBe('first version')
    expect(store.versionBytes(first.id, second.currentVersion).toString()).toBe('second version')

    managed.messages.push({ id: 'user-3', role: 'user', content: '恢复第 1 版', timestamp: Date.now() })
    managed.conversationArtifactVersions = tracker()
    await managed.conversationArtifactVersions.track(secondAnswer.content)
    const restored = await (manager as any).manageArtifactVersionFromAgent(managed, {
      action: 'restore', path: file, artifactId: first.id,
      versionId: first.currentVersion, expectedVersion: second.currentVersion,
    })
    expect(readFileSync(file, 'utf8')).toBe('first version')
    expect(restored.versions).toHaveLength(2)
    expect(restored.currentVersion).toBe(first.currentVersion)
    expect(restored.lastRestore).toMatchObject({ versionId: first.currentVersion, sourceRunId: 'session/user-3' })
    await (manager as any).processEvent(managed, { type: 'text_complete', text: '已恢复第 1 版。' })
    const restoreAnswer = managed.messages.at(-1)!
    expect(restoreAnswer.artifactVersions).toMatchObject([{ versionId: restored.currentVersion, ordinal: 1, change: 'restored' }])
    await manager.flushSession(managed.id)
    expect(loadStoredSession(root, managed.id)?.messages.at(-1)?.artifactVersions).toEqual(restoreAnswer.artifactVersions)
    expect((await manager.getSession(managed.id))?.messages.at(-1)?.artifactVersions).toEqual(restoreAnswer.artifactVersions)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Windows backslash links into .selection capture created and modified document versions', async () => {
  if (process.platform !== 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'windows-artifact-link-'))
  try {
    const sessionDir = join(root, '.selection', 'workspaces', 'my-workspace', 'sessions', 'test-session')
    mkdirSync(sessionDir, { recursive: true })
    const file = join(sessionDir, '中文 报告 (1).docx')
    const answer = `[中文 报告](<${file}>)`
    expect(localArtifactLinks(answer)).toEqual([file.replace(/\\/g, '/')])
    const store = new ArtifactVersions(join(root, 'versions'), hostname(), 'workspace')
    const tracker = () => new ConversationArtifactVersions(store, [sessionDir], async path => realpathSync(path),
      () => { throw new Error('Artifact recording failed') }, Date.now() - 1000)

    writeFileSync(file, 'hello')
    const created = await tracker().capture(answer, 'session/user-1')
    expect(created).toMatchObject([{ path: file.replace(/\\/g, '/'), ordinal: 1, change: 'created' }])

    const next = tracker()
    await next.track(answer)
    writeFileSync(file, 'hi')
    const modified = await next.capture(answer, 'session/user-2')
    expect(modified).toMatchObject([{ path: file.replace(/\\/g, '/'), ordinal: 2, change: 'modified' }])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
