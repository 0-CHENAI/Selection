import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { messageToStored } from '@craft-agent/core'
import { createSession, getSessionPath, loadSession, saveSession } from '@craft-agent/shared/sessions'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { createManagedSession, SessionManager } from './SessionManager'

const body = `已将正文替换为七言绝句，并保留标题居中、字体、段落间距及其他文档结构；这段完整说明超过四十八字，尾部必须正常呈现。

## 修改内容

- **标题**：山行即事
- 正文：四句七言诗

> 半岭松风送夕凉。

| 检查 | 结果 |
| --- | --- |
| 文件格式 | 通过 |`

for (const mode of ['stored', 'active', 'stored-nested', 'active-nested', 'missing', 'unrelated', 'edited', 'annotated', 'ordinary'] as const) {
  test(`recovers only generated Office reply bodies from their own saved revision (${mode})`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'office-reply-recovery-'))
    const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
    const manager = new SessionManager(), internal = manager as any
    manager.setEventSink(() => {})
    try {
      const file = join(root, 'hello report.docx'), candidate = join(root, 'candidate.docx')
      writeFileSync(file, 'original'); writeFileSync(candidate, 'changed')
      const child = await createSession(root, { hidden: true, parentSessionId: mode === 'unrelated' ? 'another-chat' : 'parent' })
      const nested = mode.endsWith('-nested')
      const activeChild = mode.startsWith('active')
      const candidateDirectory = join(getSessionPath(root, child.id), 'candidate', ...(nested ? ['feedback-request'] : []))
      const privateFile = join(candidateDirectory, 'hello report.docx')
      const markdown = `${body}\n\n[成果文件](<${encodeURI(privateFile)}>)`
      const savedChild = loadSession(root, child.id)!
      if (nested) savedChild.workingDirectory = candidateDirectory
      savedChild.messages = [
        { id: 'child-final', type: 'assistant', content: activeChild ? '过期磁盘回答' : markdown, phase: 'final' },
        { id: 'late-progress', type: 'assistant', content: '正在结束任务', phase: 'intermediate', isIntermediate: true },
        messageToStored({ id: 'private-draft', role: 'assistant', timestamp: 1, content: '不可显示的草稿', phase: 'final', hidden: true }),
      ]
      await saveSession(savedChild)
      if (activeChild) {
        const active = createManagedSession({ id: child.id, hidden: true, parentSessionId: 'parent', ...(nested ? { workingDirectory: candidateDirectory } : {}) }, workspace as never, { messagesLoaded: true })
        active.messages = [{ id: 'child-final', role: 'assistant', timestamp: 1, content: markdown, phase: 'final' }]
        internal.sessions.set(child.id, active)
      }
      const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
      const first = store.register(file)
      // Reproduce the old persisted 48-character title, independently of the new limit.
      const title = `${Array.from(body.split('\n')[0]!).slice(0, 47).join('')}…`
      const revised = store.apply(first.id, first.currentVersion, candidate, child.id, undefined, undefined, undefined, title)
      const legacy = `${title}\n\n已保存成果版本；请在预览中检查内容与版式。`
      const original = mode === 'edited' ? `用户自行修改：${legacy}` : legacy
      const parent = createManagedSession({ id: 'parent' }, workspace as never, { messagesLoaded: true })
      parent.messages = [
        { id: 'user', role: 'user', content: '更换内容', timestamp: 1 },
        { id: 'reply', role: 'assistant', content: original, timestamp: 2, phase: 'final',
          answerRunId: mode === 'ordinary' ? 'ordinary-run' : 'office-edit-user',
          artifactVersions: [{ artifactId: revised.id, path: revised.path, versionId: revised.currentVersion, ordinal: 2, change: 'modified' }],
          ...(mode === 'annotated' ? { annotations: [{ id: 'annotation', schemaVersion: 1 as const, createdAt: 1,
            body: [{ type: 'note' as const, text: '保留现有批注' }], target: { source: { sessionId: parent.id, messageId: 'reply' },
              selectors: [{ type: 'text-quote' as const, exact: title }] } }] } : {}),
        },
      ]
      internal.sessions.set(parent.id, parent)
      internal.persistSession(parent); await manager.flushSession(parent.id)
      if (mode === 'missing') rmSync(getSessionPath(root, child.id), { recursive: true, force: true })
      const session = await manager.getSession(parent.id)
      const expected = ['stored', 'active', 'stored-nested', 'active-nested'].includes(mode) ? `${body}\n\n[成果文件](<${encodeURI(revised.path)}>)` : original
      expect(session!.messages.at(-1)!.content).toBe(expected)
      expect(parent.messages.at(-1)!.content).toBe(expected)
      expect(loadSession(root, parent.id)!.messages.at(-1)!.content).toBe(expected)
      expect(store.read(revised.id).versions.at(-1)!.summary).toBe(title)
      expect(title).toEndWith('…')
      expect((await manager.getSession(parent.id))!.messages.at(-1)!.content).toBe(expected)
    } finally { await manager.flushSession('parent'); rmSync(root, { recursive: true, force: true }) }
  })
}
