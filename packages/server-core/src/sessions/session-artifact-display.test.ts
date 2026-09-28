import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { loadSession as loadStoredSession } from '@craft-agent/shared/sessions'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { ConversationArtifactVersions } from '../reliability/conversation-artifact-versions'
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
    expect(restored.versions).toHaveLength(3)
    expect(restored.versions.at(-1)).toMatchObject({ restoredFrom: first.currentVersion, sourceRunId: 'session/user-3' })
    await (manager as any).processEvent(managed, { type: 'text_complete', text: '已恢复第 1 版。' })
    const restoreAnswer = managed.messages.at(-1)!
    expect(restoreAnswer.artifactVersions).toMatchObject([{ versionId: restored.currentVersion, ordinal: 3, change: 'restored' }])
    await manager.flushSession(managed.id)
    expect(loadStoredSession(root, managed.id)?.messages.at(-1)?.artifactVersions).toEqual(restoreAnswer.artifactVersions)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
