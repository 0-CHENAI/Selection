import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTaskDocument, listTaskSlugs } from '@craft-agent/shared/tasks'
import { SessionManager, createManagedSession } from './SessionManager'

test('chat creation binds one canonical plan and recovers an interrupted bind without duplicating ownership', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chat-plan-'))
  const manager = new SessionManager()
  const internal = manager as any
  const workspace = { id: 'chat', name: 'Chat', slug: 'chat', rootPath: directory, createdAt: 0 }
  const root = createManagedSession({ id: 'root', workMode: 'PRO', permissionMode: 'safe', model: 'm' }, workspace, { messagesLoaded: true })
  internal.sessions.set(root.id, root)
  internal.persistSession = () => {}; internal.flushSession = async () => {}
  manager.applyTaskLabel = async () => ({ labelId: 'task' })
  manager.setEventSink(() => {})
  try {
    await expect(internal.createChatTask(root, { requestId: 'static-research', spec: {
      title: 'Research', goal: 'Verify cost', runner: 'conduct',
      research: { line: { id: 'main', question: 'Cost' }, dimensions: [{ id: 'cost', requirement: 'Verify cost' }], sources: [{ id: 'cost', path: 'cost.txt' }] },
      nodes: [{ id: 'work', prompt: 'Read originals', researchRole: 'researcher', outputs: [{ name: 'research', kind: 'param', type: 'json', required: true }] }],
    } })).rejects.toThrow('requires runner: orchestrate')
    expect(listTaskSlugs(directory)).toHaveLength(0)
    expect(root.taskSlug).toBeUndefined()
    root.isProcessing = true
    const input = { requestId: 'create-1', title: 'Compare costs', description: 'Read and compare the supplied costs' }
    await expect(internal.createChatTask(root, input)).rejects.toThrow('settle')
    expect(listTaskSlugs(directory)).toHaveLength(1)
    internal.executionOwners.set(root.id, { release: () => {}, calls: 0 })
    const result = await internal.createChatTask(root, input)
    expect(root.taskSlug).toBe(result.slug)
    expect(result.orchestratorSessionId).toBe(root.id)
    expect(await internal.createChatTask(root, input)).toEqual(result)
    expect(listTaskSlugs(directory)).toHaveLength(1)
    expect(loadTaskDocument(directory, result.slug)?.spec?.defaults?.permissionMode).toBe('safe')
    await expect(internal.createChatTask(root, { ...input, description: 'Another goal' })).rejects.toThrow('different inputs')
    await expect(internal.createChatTask(root, { ...input, requestId: 'create-2' })).rejects.toThrow('already owns')
    root.workMode = 'NORM'
    await expect(internal.createChatTask(root, input)).rejects.toThrow('NORM')
  } finally {
    internal.executionOwners.clear(); root.isProcessing = false
    manager.cleanup(); rmSync(directory, { recursive: true, force: true })
  }
})

test('chat starts reuse a reserved durable run identity and reject changed inputs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chat-start-'))
  const manager = new SessionManager(), internal = manager as any
  const workspace = { id: 'start', name: 'Start', slug: 'start', rootPath: directory, createdAt: 0 }
  const root = createManagedSession({ id: 'root', workMode: 'PRO', taskSlug: 'plan', permissionMode: 'safe' }, workspace)
  internal.sessions.set(root.id, root)
  const runs = new Map<string, any>(); let starts = 0
  manager.setTaskRunnerLookup(() => ({
    getRunState: (_slug: string, id: string) => runs.get(id),
    run: (slug: string, options: any) => {
      starts++
      const snapshot = { slug, runId: options.runId, orchestratorSessionId: options.orchestratorSessionId, status: 'running', nodes: [] }
      runs.set(options.runId, snapshot); return snapshot
    },
  }) as any)
  try {
    const input = { slug: 'plan', orchestratorSessionId: root.id, requestId: 'start-1', params: { value: 1 } }
    const first = await internal.runTaskFromTool(workspace.id, input)
    expect(await internal.runTaskFromTool(workspace.id, input)).toEqual(first)
    expect(starts).toBe(1)
    await expect(internal.runTaskFromTool(workspace.id, { ...input, params: { value: 2 } })).rejects.toThrow('different inputs')
    expect(starts).toBe(1)
  } finally { manager.cleanup(); rmSync(directory, { recursive: true, force: true }) }
})
