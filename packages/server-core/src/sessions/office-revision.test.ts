import { expect, test, spyOn } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import { createIsolatedShell } from '@craft-agent/shared/utils/isolated-shell'
import { SessionManager, createManagedSession } from './SessionManager'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { FeedbackStore } from '../reliability/feedback-store'
const binary = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
const reply = `已将选定段落的文字由 Original 改为 Changed，并保留其余段落、标题、字体、行距与原有表格结构；这段完整说明超过版本标题的三十字限制，末尾内容也必须保留。

## 修改结果

- **内容**：Changed
- 格式验证通过，最终版式请在预览中确认。

> 这是完整的 Markdown 引用。

| 项目 | 结果 |
| --- | --- |
| 段落 | Changed |`

for (const outcome of ['applied', 'cancelled', 'no-summary']) test.skipIf(!binary)(`Office chat submission uses candidate validation and records targets (${outcome})`, async () => {
  const cancel = outcome === 'cancelled'
  const root = mkdtempSync(join(tmpdir(), 'office-revision-'))
  const workspace = { id: 'office-workspace', name: 'Office', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  const file = join(workspace.rootPath, 'result.docx')
  const cli = (...args: string[]) => execFileSync(binary!, args, { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' }, timeout: 30_000 })
  cli('create', file); cli('add', file, '/body', '--type', 'p', '--prop', 'text=Original'); cli('close', file)
  const original = readFileSync(file)
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const manager = new SessionManager(), internal = manager as any
  try {
    const parent = createManagedSession({ id: 'parent', permissionMode: 'allow-all', workingDirectory: workspace.rootPath }, workspace as never, { messagesLoaded: true })
    internal.sessions.set(parent.id, parent)
    const outside = join(root, 'unrelated.docx')
    copyFileSync(file, outside)
    await expect(manager.officePreview({ type: 'open', sessionId: parent.id, path: outside })).rejects.toThrow()
    const linked = join(workspace.rootPath, 'outside-link.docx')
    symlinkSync(outside, linked)
    await expect(manager.officePreview({ type: 'open', sessionId: parent.id, path: linked })).rejects.toThrow()
    internal.persistSession = () => {}; internal.flushSession = async () => {}
    const events: any[] = []; internal.sendEvent = (event: any) => events.push(event)
    let latestPreviewId = ''
    internal.createSession = async () => {
      const child = createManagedSession({ id: 'revision', permissionMode: 'allow-all', hidden: true, parentSessionId: parent.id }, workspace as never, { messagesLoaded: true })
      internal.sessions.set(child.id, child); return { id: child.id }
    }
    manager.sendMessage = async (id, prompt) => {
      expect(prompt).toContain('Office targets')
      expect(prompt).toContain('do not launch an external browser')
      expect(prompt).toContain('Never edit using the transient selected path')
      expect(prompt).toContain('Resident sessions do not persist between tool calls')
      expect(prompt).toContain('normal Markdown reply')
      expect(prompt).toContain('version summaries are derived separately')
      expect(prompt).not.toContain('final response is version metadata')
      const child = internal.sessions.get(id)
      const candidate = join(child.workingDirectory, 'result.docx')
      expect(child.isolatedWorkspace.officeDocumentPath).toBe(candidate)
      expect(prompt).toContain(join(child.workingDirectory, '.qa'))
      const shell = createIsolatedShell(child.workingDirectory, { officeDocument: { path: candidate, binary: binary! }, denyExternalBrowsers: true })
      expect(shell).toBeDefined()
      const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
      const forward = (event: any) => internal.forwardOfficeProgress({ sessionId: id, turnId: 'revision-turn', ...event })
      try {
        forward({ type: 'text_complete', messageId: 'progress', text: '正在修改选定段落。', isIntermediate: true, phase: 'intermediate' })
        for (const [index, command] of [
          `${quote(binary!)} open ${quote(candidate)}`,
          `${quote(binary!)} set ${quote(candidate)} '/body/p[1]' --prop text=Changed`,
          `${quote(binary!)} get ${quote(candidate)} '/body/p[1]' --json`,
        ].entries()) {
          forward({ type: 'tool_start', toolName: 'Bash', toolUseId: `call-${index}`, toolInput: { command } })
          let output = ''
          expect((await shell!.operations.exec(command, child.workingDirectory, { onData: bytes => { output += bytes.toString() }, timeout: 30 })).exitCode).toBe(0)
          if (index === 2) { expect(output).toContain('Changed'); expect(output).not.toContain('previous session ended') }
          forward({ type: 'tool_result', toolName: 'Bash', toolUseId: `call-${index}`, result: output })
        }
        forward({ type: 'text_delta', delta: '完整正文不应重复显示', phase: 'unclassified' })
        forward({ type: 'text_complete', messageId: 'child-final', text: '完整正文不应重复显示', isIntermediate: false, phase: 'unclassified' })
        forward({ type: 'complete' })
        expect(events.filter(event => event.type === 'complete')).toHaveLength(0)
      } finally { shell?.dispose() }
      const draft = (await manager.officePreview({ type: 'refresh', sessionId: parent.id, previewId: latestPreviewId }))!
      latestPreviewId = draft.previewId
      expect(draft.isDraft).toBe(true)
      expect(draft.html).toContain('Changed')
      await expect(manager.officePreview({ type: 'capture', sessionId: parent.id, previewId: latestPreviewId })).rejects.toThrow('仅供预览')
      await expect(manager.officePreview({ type: 'select', sessionId: parent.id, previewId: latestPreviewId, paths: ['/body/p[1]'] })).rejects.toThrow('仅供预览')
      if (outcome !== 'no-summary') child.messages.push(
        { id: 'revision-answer', role: 'assistant', content: `${reply}\n\n[成果文件](<${candidate}>)`, timestamp: Date.now(), isIntermediate: false, phase: 'final' },
        { id: 'late-progress', role: 'assistant', content: '正在结束候选任务。', timestamp: Date.now(), isIntermediate: true, phase: 'intermediate' },
      )
      if (cancel) await manager.cancelProcessing(parent.id)
    }
    const preview = (await manager.officePreview({ type: 'open', sessionId: parent.id, path: file }))!
    latestPreviewId = preview.previewId
    await manager.officePreview({ type: 'select', sessionId: parent.id, previewId: preview.previewId, paths: ['/body/p[1]'] })
    const selection = (await manager.officePreview({ type: 'capture', sessionId: parent.id, previewId: preview.previewId }))!.selection!
    let acknowledged = false
    await internal.sendOfficeRevision(parent, 'Change selected paragraph', { officeSelection: selection, optimisticMessageId: 'office-request' }, () => { acknowledged = true })
    expect(acknowledged).toBe(true)
    expect(parent.isProcessing).toBe(false)
    expect(events.some(event => event.type === 'status' && event.sessionId === parent.id)).toBe(false)
    expect(events.at(-1).type).toBe('complete')
    const final = events.findLast(event => event.type === 'text_complete')
    expect(final.answerCommitted).toBe(true)
    expect(final.answerRunId).toStartWith('office-edit-')
    expect(events.at(-1).answerRunId).toBe(final.answerRunId)
    await expect(internal.sendOfficeRevision(parent, 'Change selected paragraph', {
      officeSelection: { ...selection, artifactId: 'different-file' }, optimisticMessageId: 'office-request',
    })).rejects.toThrow('different feedback')
    const versions = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id).read(selection.artifactId)
    const published = (await manager.officePreview({ type: 'refresh', sessionId: parent.id, previewId: latestPreviewId }))!
    expect(published.isDraft).toBe(false)
    expect(published.baseVersion).toBe(versions.currentVersion)
    expect(published.html).toContain(cancel ? 'Original' : 'Changed')
    const feedback = new FeedbackStore(join(workspace.rootPath, 'artifacts', 'feedback')).list(parent.id, selection.artifactId)[0]!
    expect(feedback.officeSelection).toEqual(selection)
    expect(versions.versions).toHaveLength(cancel ? 1 : 2)
    if (cancel) expect(readFileSync(file)).toEqual(original)
    else {
      expect(parent.messages.at(-1)!.artifactVersions![0]!.versionId).toBe(versions.currentVersion)
      expect(parent.messages.at(-1)!.content).toContain(outcome === 'no-summary' ? '选定的 1 个元素' : '由 Original 改为 Changed')
      expect(parent.messages.at(-1)!.content).not.toContain('目标：')
      const expected = outcome === 'no-summary' ? '已修改 result.docx 中选定的 1 个元素。\n\n已保存成果版本；请在预览中检查内容与版式。'
        : `${reply}\n\n[成果文件](<${versions.path}>)`
      expect(parent.messages.at(-1)!.content).toBe(expected)
      expect(final.text).toBe(expected)
      expect(final.text).not.toContain('…')
      expect(versions.versions.at(-1)).toMatchObject({
        summaryOrigin: 'assistant',
      })
      const summary = versions.versions.at(-1)!.summary!
      if (outcome === 'no-summary') expect(summary).toBe('已修改 result.docx 中选定的 1 个元素。')
      else { expect(Array.from(summary).length).toBeLessThanOrEqual(30); expect(summary).not.toContain('…') }
    }
    const progress = parent.messages.filter(message => message.toolUseId?.startsWith('office-') || message.isIntermediate)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every(message => message.answerRunId === final.answerRunId && message.answerRoutingVersion === 1)).toBe(true)
    expect(events.filter(event => event.type === 'text_complete' && !event.isIntermediate)).toHaveLength(1)
    expect(parent.messages.some(message => message.content.includes('完整正文不应重复显示'))).toBe(false)
  } finally { internal.officePreviews.dispose(); lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
}, 60_000)

test('Office progress streams into the parent without completing it or publishing child artifacts', () => {
  const manager = new SessionManager(), internal = manager as any
  const workspace = { id: 'office-workspace', name: 'Office', rootPath: '/tmp/office-progress' }
  const parent = createManagedSession({ id: 'parent' }, workspace as never, { messagesLoaded: true })
  internal.sessions.set(parent.id, parent)
  internal.officeRevisionRuns.set(parent.id, 'feedback')
  internal.officeRevisionAnswerRuns.set(parent.id, 'office-edit-request')
  internal.officeProgressParents.set('child', parent.id)
  internal.persistSession = () => {}
  const events: any[] = []
  internal.sendEvent = (event: any) => events.push(event)
  const forward = (event: any) => internal.forwardOfficeProgress({ sessionId: 'child', turnId: 'turn-1', ...event })
  forward({ type: 'text_delta', delta: '正在调整段落', phase: 'final' })
  expect(events).toHaveLength(0)
  forward({ type: 'text_delta', delta: '正在调整段落', phase: 'intermediate' })
  expect(events[0]).toMatchObject({ sessionId: 'parent', phase: 'intermediate', delta: '正在调整段落', answerRunId: 'office-edit-request', answerRoutingVersion: 1 })
  forward({ type: 'tool_start', toolName: 'Bash', toolUseId: 'call-1', toolInput: {} })
  forward({ type: 'tool_start', toolName: 'Bash', toolUseId: 'call-1', toolInput: { command: 'officecli get' } })
  forward({ type: 'tool_result', toolName: 'Bash', toolUseId: 'call-1', result: 'done' })
  expect(parent.messages.filter(message => message.role === 'tool')).toHaveLength(1)
  expect(parent.messages[0]).toMatchObject({ toolStatus: 'completed', toolResult: 'done', toolInput: { command: 'officecli get' } })
  forward({ type: 'text_complete', text: '正在调整段落', messageId: 'progress', isIntermediate: true, phase: 'intermediate' })
  expect(events.at(-1)).toMatchObject({ isIntermediate: true, phase: 'intermediate', answerCommitted: undefined, artifactVersions: undefined })
  expect(parent.messages.at(-1)).toMatchObject({ content: '正在调整段落', isIntermediate: true, answerRunId: 'office-edit-request', answerRoutingVersion: 1 })
  const beforeFinal = events.length
  for (const final of [
    { text: '未分类的完整报告', isIntermediate: false, phase: 'unclassified' },
    { text: '原生最终报告', isIntermediate: false, phase: 'final' },
    { text: '显式提交的报告', isIntermediate: true, answerCommitted: true, phase: 'intermediate' },
  ]) forward({ type: 'text_complete', messageId: 'answer', artifactVersions: [{ path: 'candidate.docx' }], ...final })
  expect(events).toHaveLength(beforeFinal)
  forward({ type: 'permission_request', request: { requestId: 'approval', sessionId: 'child' } })
  expect(events.at(-1)).toMatchObject({ type: 'permission_request', sessionId: 'parent', request: { requestId: 'approval', sessionId: 'parent' } })
  const count = events.length
  forward({ type: 'complete' })
  forward({ type: 'user_message', message: { content: 'private prompt' } })
  expect(events).toHaveLength(count)
  internal.officeProgressParents.delete('child')
  forward({ type: 'text_delta', delta: 'late' })
  expect(events).toHaveLength(count)
})

test('Office approval routes to its child only while the parent owns that revision', () => {
  const manager = new SessionManager(), internal = manager as any
  const responses: unknown[] = []
  internal.sessions.set('child', { agent: { respondToPermission: (...args: unknown[]) => responses.push(args) } })
  internal.officeProgressParents.set('child', 'parent')
  internal.officeRevisionRuns.set('parent', 'feedback')
  internal.pendingPermissionRequests.set('request', { sessionId: 'child', type: 'bash' })
  expect(manager.respondToPermission('unrelated', 'request', true, false)).toBe(false)
  expect(responses).toHaveLength(0)
  expect(manager.respondToPermission('parent', 'request', true, false)).toBe(true)
  expect(responses).toEqual([['request', true, false]])
  internal.pendingPermissionRequests.set('late', { sessionId: 'child', type: 'bash' })
  internal.officeRevisionRuns.delete('parent')
  expect(manager.respondToPermission('parent', 'late', true, false)).toBe(false)
})

test('Office monitor failure is visible after acknowledgement and cancels outstanding work', async () => {
  const manager = new SessionManager(), internal = manager as any
  const parent = createManagedSession({ id: 'parent', permissionMode: 'allow-all' },
    { id: 'workspace', name: 'Workspace', rootPath: '/tmp/office-monitor-test' } as never, { messagesLoaded: true })
  internal.sessions.set(parent.id, parent)
  internal.persistSession = () => {}; internal.flushSession = async () => {}
  internal.officePreviews.assertCaptured = () => {}
  const events: any[] = [], operations: string[] = []
  internal.sendEvent = (event: any) => events.push(event)
  internal.artifactFeedback = async (operation: any) => {
    operations.push(operation.type)
    if (operation.type === 'get') throw new Error('feedback unavailable')
    return { id: 'feedback', status: operation.type === 'cancel' ? 'cancelled' : 'running' }
  }
  let acknowledged = false
  await internal.sendOfficeRevision(parent, 'Edit', { officeSelection: { artifactId: 'artifact', baseVersion: 'version' } }, () => { acknowledged = true })
  expect(acknowledged).toBe(true)
  expect(operations).toEqual(['create', 'get', 'cancel'])
  expect(events.find(event => event.type === 'error')?.error).toContain('feedback unavailable')
  expect(parent.messages.at(-1)?.role).toBe('error')
  expect(parent.isProcessing).toBe(false)
  expect(internal.officeRevisionRuns.has(parent.id)).toBe(false)
  expect(events.at(-1).type).toBe('complete')
})

test('settling interrupted Office progress leaves ordinary and completed tools unchanged', () => {
  const internal = new SessionManager() as any
  const office = { role: 'tool', toolUseId: 'office-child-call', toolStatus: 'executing' }
  const ordinary = { role: 'tool', toolUseId: 'normal-call', toolStatus: 'executing' }
  const completed = { role: 'tool', toolUseId: 'office-child-done', toolStatus: 'completed', toolResult: 'ok' }
  internal.settleOfficeProgress({ messages: [office, ordinary, completed] })
  expect(office).toMatchObject({ toolStatus: 'error', isError: true })
  expect(ordinary.toolStatus).toBe('executing')
  expect(completed).toMatchObject({ toolStatus: 'completed', toolResult: 'ok' })
})
