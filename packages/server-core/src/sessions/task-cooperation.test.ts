import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTaskSpec, saveTaskSpec } from '@craft-agent/shared/tasks'
import * as config from '@craft-agent/shared/config/storage'
import { SessionManager, createManagedSession } from './SessionManager'
import { TaskRunner } from '../tasks/TaskRunner'

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
test('production spawn lifecycle preserves canonical worker binding and cannot escape its node permissions', async () => {
  const path = mkdtempSync(join(tmpdir(), 'task-cooperation-'))
  const enabled = spyOn(config, 'getSwarmAgentsEnabled').mockReturnValue(true)
  const manager = new SessionManager(), internal = manager as any
  const workspace = { id: 'cooperation', name: 'Workspace', slug: 'workspace', rootPath: path, createdAt: 0 }
  const root = createManagedSession({ id: 'root', workMode: 'PRO', swarmEnabled: true, permissionMode: 'safe', model: 'm', llmConnection: 'connection' }, workspace, { messagesLoaded: true })
  internal.sessions.set(root.id, root)
  internal.persistSession = () => {}; internal.flushSession = async () => {}
  manager.setEventSink(() => {})
  const created: any[] = [], sent: string[] = []
  internal.createSession = async (_workspace: string, options: any) => {
    created.push(options)
    const id = options.taskWorkerId ? 'delegated-reviewer' : 'primary'
    const child = createManagedSession({ ...options, id, executionRootSessionId: root.id, workMode: 'PRO' }, workspace, { messagesLoaded: true })
    internal.sessions.set(id, child); return { id }
  }
  internal.sendMessage = async (id: string) => { sent.push(id) }
  manager.onSessionComplete(event => internal.surfaceSpawnedSessionCompletion(event))
  const parsed = parseTaskSpec({ schema_version: 3, id: 'cooperation', title: 'Cooperation', goal: 'Check output', runner: 'conduct', execution: { verification: { required: false } }, nodes: [{ id: 'a', prompt: 'Primary A' }] })
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error)); saveTaskSpec(path, parsed.data)
  const runner = new TaskRunner({ host: manager, workspaceId: workspace.id, workspaceRoot: path })
  manager.setTaskRunnerLookup(() => runner)
  try {
    runner.run('cooperation', { runId: 'r', orchestratorSessionId: root.id, verifyOnComplete: false }); await tick()
    internal.issueSpawnQualificationCredentials(root, 'user-requested')
    await expect(internal.spawnSessionFromTool(root, { prompt: 'Hidden outside work', spawnReason: 'user-requested' })).rejects.toThrow('taskBinding')
    root.permissionMode = 'allow-all'
    await expect(internal.spawnSessionFromTool(root, { prompt: 'Write outside node permission', spawnReason: 'user-requested', permissionMode: 'allow-all', taskBinding: { runId: 'r', nodeId: 'a' }, workingDirectory: path })).rejects.toThrow('exceeds the owning task node')
    expect(created).toHaveLength(1)
    internal.issueSpawnQualificationCredentials(root, 'user-requested')
    const result = await internal.spawnSessionFromTool(root, { prompt: 'Independent source review', spawnReason: 'user-requested', taskBinding: { runId: 'r', nodeId: 'a' }, role: 'reviewer' })
    expect(result.sessionId).toBe('delegated-reviewer')
    const options = created[1]
    expect(options).toMatchObject({ taskSlug: 'cooperation', taskRunId: 'r', taskNodeId: 'a', taskAttempt: 1, taskRevision: 0, permissionMode: 'safe', parentSessionId: root.id })
    expect(typeof options.taskWorkerId).toBe('string')
    expect(manager.getSwarmRunDetails(root.id, workspace.id)!.nodes.some(node => node.sessionId === 'delegated-reviewer')).toBe(true)
    const primary = internal.sessions.get('primary'); primary.isProcessing = false
    internal.emitSessionComplete({ sessionId: primary.id, workspaceId: workspace.id, generation: 1, reason: 'complete', finalText: 'A output' })
    expect(runner.getRunState('cooperation','r')!.nodes[0]!.state).toBe('running')
    const worker = internal.sessions.get('delegated-reviewer'); worker.isProcessing = false
    internal.emitSessionComplete({ sessionId: worker.id, workspaceId: workspace.id, generation: 0, reason: 'complete', finalText: 'Source review output' })
    await tick()
    const snapshot = runner.getRunState('cooperation','r')!
    expect(snapshot.status).toBe('completed')
    expect(snapshot.workers).toHaveLength(1)
    expect(snapshot.workers?.find(record => record.sessionId === worker.id)).toMatchObject({ rootSessionId: root.id, nodeId: 'a', attempt: 1, state: 'done', output: { text: 'Source review output' } })
    expect(sent.filter(id => id === root.id)).toHaveLength(0)
    expect(root.orchestrationAggregation).toBeUndefined()
  } finally { enabled.mockRestore(); manager.cleanup(); rmSync(path, { recursive: true, force: true }) }
})

test('actor context reuse requires original read bytes and refuses unverifiable external context', () => {
  const path = mkdtempSync(join(tmpdir(), 'actor-source-'))
  const manager = new SessionManager(), internal = manager as any
  const workspace = { id: 'actor-source', name: 'Workspace', slug: 'workspace', rootPath: path, createdAt: 0 }
  const actor = createManagedSession({ id: 'actor', workMode: 'PRO', taskActor: { id: 'analyst' }, workingDirectory: path }, workspace, { messagesLoaded: true })
  internal.sessions.set(actor.id, actor)
  actor.executionCheckpoint = { version: 1, sessionId: actor.id, userMessageId: 'u', generation: 1, status: 'completed', pendingTools: {}, completedTools: [], updatedAt: 1 }
  try {
    const { writeFileSync } = require('node:fs')
    const file = join(path,'source.txt'); writeFileSync(file,'original source')
    internal.captureTaskContextRead(actor,'Read',{ file_path: file },'read-source')
    expect(manager.canReuseTaskSession(actor.id)).toBe(false)
    actor.executionCheckpoint.contextReads!['read-source']!.complete = true
    expect(manager.canReuseTaskSession(actor.id)).toBe(true)
    writeFileSync(file,'changed source')
    expect(manager.canReuseTaskSession(actor.id)).toBe(false)
    writeFileSync(file,'original source'); actor.enabledSourceSlugs = ['external-source']
    expect(manager.canReuseTaskSession(actor.id)).toBe(false)
    actor.enabledSourceSlugs = []
    internal.captureTaskContextRead(actor,'WebFetch',{ url: 'https://example.com' },'external')
    expect(manager.canReuseTaskSession(actor.id)).toBe(false)
  } finally { manager.cleanup(); rmSync(path,{recursive:true,force:true}) }
})
