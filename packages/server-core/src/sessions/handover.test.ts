import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import * as config from '@craft-agent/shared/config'
import { getSessionPath, getSessionFilePath, loadSession } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { HandoverStore } from '../reliability/handover-store'
import { writeExecutionCheckpoint } from '../reliability/execution-checkpoint'
import { parseTaskSpec, saveTaskSpec, writeSpecRevision, freezeResearchSources, ResearchPayloadSchema, appendRunLog, writeNodeAttempt, writeNodeOutput, runDir, type ResearchRecord } from '@craft-agent/shared/tasks'
import { TaskRunner } from '../tasks/TaskRunner'

async function fixture(mode: 'NORM' | 'PRO' = 'NORM') {
  const root = mkdtempSync(join(tmpdir(), 'selection-handover-'))
  const workspace = { id: 'handover-workspace', slug: 'handover', name: 'Handover', rootPath: root, createdAt: 1 }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace)
  const workspaces = spyOn(config, 'getWorkspaces').mockReturnValue([workspace])
  const manager = new SessionManager(), internal = manager as any
  const source = await manager.createSession(workspace.id, { workMode: mode, permissionMode: 'allow-all', model: 'gpt-6-luna', name: '成本分析' })
  const managed = internal.sessions.get(source.id)
  const file = join(root, 'costs.txt'); writeFileSync(file, 'A 两年 1000000 元；B 口径待核对。')
  const versions = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
  const artifact = versions.register(file)
  managed.messages.push({ id: 'goal', role: 'user', content: '比较 A/B 两年成本与风险；只读资料，不部署。说明无法核实的口径。', timestamp: 1 },
    { id: 'read', role: 'tool', toolName: 'Read', toolUseId: 'read-costs', toolInput: { file_path: file }, toolStatus: 'completed', content: readFileSync(file, 'utf8'), timestamp: 2 },
    { id: 'answer', role: 'assistant', content: 'A 两年 1000000 元；B 口径未知，风险资料有缺口。', timestamp: 3,
      artifactVersions: [{ path: file, artifactId: artifact.id, versionId: artifact.currentVersion }] })
  internal.persistSession(managed); await manager.flushAllSessions()
  const store = new HandoverStore(join(root, 'handovers'), workspace.id)
  return { root, workspace, manager, internal, source: managed, file, artifact, store, cleanup: async () => {
    await manager.flushAllSessions(); manager.cleanup(); lookup.mockRestore(); workspaces.mockRestore(); rmSync(root, { recursive: true, force: true })
  } }
}

test('F5-d research handover preserves current reviewed versions, uncovered questions and independent source bytes', async () => {
  const f = await fixture('PRO')
  try {
    const parsed = parseTaskSpec({ schema_version: 3, id: 'research', title: 'Research', goal: 'cost and risk', research: {
      line: { id: 'main', question: 'cost and risk' }, dimensions: [{ id: 'cost', requirement: 'cost evidence' }, { id: 'risk', requirement: 'risk evidence' }], sources: [{ id: 'source', path: 'costs.txt' }],
    }, nodes: ['researcher', 'reviewer', 'reporter'].map(role => ({ id: role, researchRole: role, prompt: role, outputs: [{ name: 'research', kind: 'param', type: 'json', required: true }] })) })
    expect(parsed.success).toBe(true); if (!parsed.success) return
    saveTaskSpec(f.root, parsed.data); writeSpecRevision(f.root, 'research', 'r', 0, parsed.data)
    const sources = freezeResearchSources(f.root, 'research', 'r', parsed.data.research!, f.root)
    appendRunLog(f.root, 'research', 'r', { t: new Date().toISOString(), kind: 'run-started', taskId: 'research', runId: 'r', orchestratorSessionId: f.source.id, researchSourcesHash: createHash('sha256').update(JSON.stringify(sources)).digest('hex') })
    const payloads = [
      { evidence: [{ id: 'e', sourceId: 'source', sourceVersion: sources[0]!.version, locator: { startLine: 1, endLine: 1 }, excerpt: readFileSync(f.file, 'utf8') }], claims: [{ id: 'cost', version: 2, type: 'fact', text: 'A two-year cost is 1000000 yuan.', dimensionIds: ['cost'], evidenceIds: ['e'], critical: true, keyNumber: true }] },
      { reviews: [{ claimRef: { id: 'cost', version: 2 }, citationExists: true, support: 'supported', finding: 'Original supports this version' }] },
      { report: { claimRefs: [{ id: 'cost', version: 2 }], limitations: ['Risk unavailable'], unresolved: ['Need risk evidence'] } },
    ]
    parsed.data.nodes.forEach((node, index) => {
      const payload = ResearchPayloadSchema.parse(payloads[index]), output = { text: node.id, params: { research: payload } }
      writeNodeAttempt(f.root, 'research', 'r', node.id, 1, output); writeNodeOutput(f.root, 'research', 'r', node.id, output)
      const researchRecord: ResearchRecord = { role: node.researchRole!, payload, producedBy: { runId: 'r', nodeId: node.id, revision: 0, attempt: 1, sessionId: `child-${node.id}`, artifactVersion: createHash('sha256').update(JSON.stringify(output)).digest('hex') } }
      appendRunLog(f.root, 'research', 'r', { t: new Date().toISOString(), kind: 'node-finished', nodeId: node.id, sessionId: `child-${node.id}`, state: 'done', researchRecord })
    })
    appendRunLog(f.root, 'research', 'r', { t: new Date().toISOString(), kind: 'run-completed' })
    f.source.taskSlug = 'research'; f.internal.persistSession(f.source)
    f.manager.setTaskRunnerLookup(() => new TaskRunner({ host: f.manager, workspaceId: f.workspace.id, workspaceRoot: f.root }))
    const record = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'research-handover', targetMode: 'NORM' })).records[0]!
    expect(record.status).toBe('applied')
    const result = JSON.parse(record.snapshot!.originals.find(original => original.role === 'task-result')!.text)
    expect(result.research.report.claimRefs).toEqual([{ id: 'cost', version: 2 }])
    expect(result.research.claims[0].review.claimRef.version).toBe(2)
    expect(result.research.coverage).toEqual({ covered: 1, limited: 0, uncovered: 1, total: 2 })
    expect(record.snapshot!.openQuestions.join(' ')).toContain('main/risk: uncovered')
    const copy = record.snapshot!.files.find(file => file.originalPath === sources[0]!.snapshotPath)!
    expect(copy.hash).toBe(sources[0]!.hash!)
    rmSync(join(runDir(f.root, 'research', 'r'), 'research'), { recursive: true })
    const target = await f.manager.getSession(record.targetSessionId!)
    expect(target?.workMode).toBe('NORM'); expect(target?.parentSessionId).toBeUndefined()
    expect(readFileSync(join(getSessionPath(f.root, target!.id), 'data', 'handover', record.handoverId, copy.snapshotPath), 'utf8')).toContain('1000000')
    expect(f.internal.handoverInput(f.internal.sessions.get(target!.id))).toContain('cost')
  } finally { await f.cleanup() }
})

test('F6 handover keeps predecessor results as history and only successor gaps as current', async () => {
  const f = await fixture('PRO')
  try {
    f.source.taskSlug = 'lineage'
    const parsed = parseTaskSpec({ schema_version: 3, id: 'lineage', title: 'Lineage', goal: 'old goal', nodes: [{ id: 'a', prompt: 'read' }] })
    expect(parsed.success).toBe(true); if (!parsed.success) return
    saveTaskSpec(f.root, parsed.data)
    writeSpecRevision(f.root, 'lineage', 'old', 0, parsed.data)
    writeSpecRevision(f.root, 'lineage', 'new', 0, { ...parsed.data, goal: 'current goal' })
    const event = { t: new Date().toISOString() }
    appendRunLog(f.root, 'lineage', 'old', { ...event, kind: 'run-started', taskId: 'lineage', runId: 'old', orchestratorSessionId: f.source.id })
    appendRunLog(f.root, 'lineage', 'old', { ...event, kind: 'node-scheduled', nodeId: 'a' })
    appendRunLog(f.root, 'lineage', 'old', { ...event, kind: 'run-paused' })
    appendRunLog(f.root, 'lineage', 'new', { ...event, kind: 'run-started', taskId: 'lineage', runId: 'new', orchestratorSessionId: f.source.id, resumedFrom: 'old' })
    appendRunLog(f.root, 'lineage', 'old', { ...event, kind: 'run-superseded', supersededBy: 'new' })
    writeNodeOutput(f.root, 'lineage', 'new', 'a', { text: 'current result' })
    appendRunLog(f.root, 'lineage', 'new', { ...event, kind: 'node-finished', nodeId: 'a', state: 'done', sessionId: 'current-author' })
    appendRunLog(f.root, 'lineage', 'new', { ...event, kind: 'run-completed' })
    f.manager.setTaskRunnerLookup(() => new TaskRunner({ host: f.manager, workspaceId: f.workspace.id, workspaceRoot: f.root }))
    const record = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'lineage-handover', targetMode: 'NORM' })).records[0]!
    expect(record.snapshot!.goal).toContain('current goal')
    expect(record.snapshot!.goal).not.toContain('old goal')
    expect(record.snapshot!.openQuestions.join(' ')).not.toContain('Source retains lineage/a')
    expect(record.snapshot!.runs.find(run => run.runId === 'old')?.supersededBy).toBe('new')
    expect(record.snapshot!.runs.find(run => run.runId === 'new')?.resumedFrom).toBe('old')
    const history = JSON.parse(record.snapshot!.originals.find(original => original.role === 'task-history')!.text)
    const current = JSON.parse(record.snapshot!.originals.find(original => original.role === 'task-result')!.text)
    expect(history.runId).toBe('old'); expect(history.nodes[0].state).toBe('running')
    expect(current.runId).toBe('new'); expect(current.nodes[0].output).toBe('current result')
    expect(f.internal.handoverInput(f.internal.sessions.get(record.targetSessionId!))).toContain('Superseded runs')
  } finally { await f.cleanup() }
})

test('F2 handover preserves source, constraints, file versions and independent target permissions', async () => {
  const f = await fixture()
  try {
    const original = readFileSync(getSessionFilePath(f.root, f.source.id), 'utf8')
    const request = { type: 'create' as const, handoverId: 'f2', targetMode: 'PRO' as const }
    const first = (await f.manager.handoverSession(f.source.id, request)).records[0]!
    expect(first.status).toBe('applied')
    const target = await f.manager.getSession(first.targetSessionId!)
    expect(target).toMatchObject({ workMode: 'PRO', permissionMode: 'safe', model: f.source.model })
    expect(target?.parentSessionId).toBeUndefined()
    expect(target?.handover).toMatchObject({ handoverId: 'f2', sourceSessionId: f.source.id, snapshotVersion: 1 })
    expect(first.snapshot?.constraints.join(' ')).toContain('不部署')
    expect(first.snapshot?.goal.join(' ')).toContain('两年')
    expect(first.snapshot?.claims.every(claim => claim.reviewStatus === 'unreviewed')).toBe(true)
    expect(first.snapshot?.files.some(file => file.versionId === f.artifact.currentVersion && file.artifactId === f.artifact.id)).toBe(true)
    expect(readFileSync(getSessionFilePath(f.root, f.source.id), 'utf8')).toBe(original)
    const again = (await f.manager.handoverSession(f.source.id, request)).records[0]!
    expect(again.targetSessionId).toBe(first.targetSessionId)
    expect(f.internal.sessions.size).toBe(2)
    expect(loadSession(f.root, first.targetSessionId!)?.messages.filter(message => message.id === 'handover-f2')).toHaveLength(1)
    // Explicitly creating another handover gets a fresh snapshot/target; retries never refresh one.
    writeFileSync(f.file, 'changed later')
    const changed = await f.manager.handoverSession(first.targetSessionId!, { type: 'get', handoverId: 'f2' })
    expect(changed.changes?.every(file => file.state === 'changed')).toBe(true)
    const copied = join(getSessionPath(f.root, first.targetSessionId!), 'data', 'handover', 'f2', first.snapshot!.files[0]!.snapshotPath)
    expect(readFileSync(copied, 'utf8')).toContain('1000000')
    const before = f.internal.handoverInput(f.internal.sessions.get(first.targetSessionId!))
    await f.manager.deleteSession(f.source.id)
    expect(existsSync(getSessionFilePath(f.root, f.source.id))).toBe(false)
    expect(f.internal.handoverInput(f.internal.sessions.get(first.targetSessionId!))).toBe(before)
    expect(readFileSync(copied, 'utf8')).toContain('1000000')
    const norm = (await f.manager.handoverSession(first.targetSessionId!, { type: 'create', handoverId: 'f2-back', targetMode: 'NORM' })).records[0]!
    expect((await f.manager.getSession(norm.targetSessionId!))?.workMode).toBe('NORM')
    expect(norm.snapshot?.constraints.join(' ')).toContain('不部署')
    expect(norm.snapshot?.files.some(file => file.versionId === f.artifact.currentVersion)).toBe(true)
  } finally { await f.cleanup() }
})

test('crash after target creation retries the same durable target and applies background once', async () => {
  const f = await fixture()
  let restarted: SessionManager | undefined
  try {
    const apply = f.internal.applyHandoverInput.bind(f.manager)
    f.internal.applyHandoverInput = async () => { throw new Error('crash-before-input') }
    await expect(f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'crash', targetMode: 'PRO' })).rejects.toThrow('crash-before-input')
    const created = f.store.read('crash')!
    expect(created.status).toBe('created')
    expect(loadSession(f.root, created.targetSessionId!)?.messages).toHaveLength(0)
    await f.manager.flushAllSessions()
    restarted = new SessionManager()
    ;(restarted as any).loadSessionsFromDisk()
    const retried = (await restarted.handoverSession(f.source.id, { type: 'create', handoverId: 'crash', targetMode: 'PRO' })).records[0]!
    expect(retried).toMatchObject({ status: 'applied', targetSessionId: created.targetSessionId })
    expect((restarted as any).sessions.size).toBe(2)
    await restarted.handoverSession(created.targetSessionId!, { type: 'get', handoverId: 'crash' })
    expect(loadSession(f.root, created.targetSessionId!)?.messages.filter(message => message.id === 'handover-crash')).toHaveLength(1)
    f.internal.applyHandoverInput = apply
  } finally { if (restarted) { await restarted.flushAllSessions(); restarted.cleanup() }; await f.cleanup() }
})

test('active worker waits without a target; cancelling waiting never stops source work', async () => {
  const f = await fixture('PRO')
  try {
    const child = createManagedSession({ id: 'worker', workMode: 'PRO', executionRootSessionId: f.source.id, parentSessionId: f.source.id }, f.workspace, { messagesLoaded: true, isProcessing: true })
    f.internal.sessions.set(child.id, child)
    const waiting = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'wait', targetMode: 'NORM' })).records[0]!
    expect(waiting.status).toBe('waiting')
    expect(waiting.targetSessionId).toBeUndefined()
    expect(waiting.error).toContain('Waiting')
    await f.manager.handoverSession(f.source.id, { type: 'cancel', handoverId: 'wait' })
    expect(child.isProcessing).toBe(true)
    expect(f.store.read('wait')?.status).toBe('cancelled')
    const again = await f.manager.handoverSession(f.source.id, { type: 'get', handoverId: 'wait' })
    expect(again.records[0]?.status).toBe('cancelled')
    child.isProcessing = false
    const pending = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'wait-next', targetMode: 'NORM' })).records[0]!
    expect(pending.status).toBe('applied')
  } finally { await f.cleanup() }
})

test('unknown external operations block side effects until explicit review; completed calls never replay', async () => {
  const f = await fixture()
  try {
    f.source.messages.push({ id: 'sent', role: 'tool', toolName: 'external_send', toolUseId: 'send', toolInput: { target: 'example', value: 'sent' }, toolStatus: 'completed', content: 'delivery confirmed', timestamp: 4 },
      { id: 'unknown', role: 'tool', toolName: 'external_publish', toolUseId: 'publish', toolInput: { target: 'example' }, toolStatus: 'error', content: '结果未知', timestamp: 5 },
      { id: 'auth', role: 'auth-request', content: 'api_key=never-transfer', timestamp: 6 },
      { id: 'user-secret', role: 'user', content: 'api_key=secret123 不部署', timestamp: 7 })
    f.internal.persistSession(f.source); await f.manager.flushAllSessions()
    writeExecutionCheckpoint(getSessionPath(f.root, f.source.id), { version: 1, sessionId: f.source.id, userMessageId: 'goal', generation: 0, status: 'blocked', pendingTools: { publish: { name: 'external_publish', recovery: 'unknown' } }, completedTools: ['send'], updatedAt: Date.now() })
    const record = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'effects', targetMode: 'PRO' })).records[0]!
    const target = f.internal.sessions.get(record.targetSessionId!)
    expect(JSON.stringify(record.snapshot)).not.toContain('never-transfer')
    expect(JSON.stringify(record.snapshot)).not.toContain('secret123')
    expect(JSON.stringify(record.snapshot)).not.toContain('allow-all')
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'Read', { file_path: f.file })).not.toThrow()
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'external_send', { value: 'sent', target: 'example' })).toThrow('already completed')
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'Write', { file_path: f.file })).toThrow('unknown outcomes')
    expect(() => f.manager.assertTaskRunAllowed(f.workspace.id, target.id)).toThrow('unknown outcomes')
    await f.manager.handoverSession(target.id, { type: 'review', handoverId: 'effects', actionRef: `${f.source.id}:publish`, outcome: 'not-performed', note: 'Verified the remote system: no publication occurred.' })
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'Write', { file_path: f.file })).not.toThrow()
    expect(target.permissionMode).toBe('safe')
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'external_send', { target: 'example', value: 'sent' })).toThrow('already completed')
    const worker = createManagedSession({ id: 'handover-worker', workMode: 'PRO', parentSessionId: target.id, executionRootSessionId: target.id }, f.workspace, { messagesLoaded: true })
    expect(() => f.internal.assertHandoverOperationAllowed(worker, 'external_send', { target: 'example', value: 'sent' })).toThrow('already completed')
  } finally { await f.cleanup() }
})


test('concurrent clicks share one target and frozen input', async () => {
  const f = await fixture()
  try {
    await Promise.all([f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'double-click', targetMode: 'PRO' }), f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'double-click', targetMode: 'PRO' })])
    const record = (await f.manager.handoverSession(f.source.id, { type: 'get', handoverId: 'double-click' })).records[0]!
    expect(record.status).toBe('applied')
    expect(f.internal.sessions.size).toBe(2)
    expect(loadSession(f.root, record.targetSessionId!)?.messages.filter(message => message.id === 'handover-double-click')).toHaveLength(1)
  } finally { await f.cleanup() }
})

test('prepared reservation and already-applied input recover across both crash windows', async () => {
  const f = await fixture()
  let restarted: SessionManager | undefined
  try {
    const create = f.manager.createSession.bind(f.manager)
    f.manager.createSession = async () => { throw new Error('crash-before-target') }
    await expect(f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'reservation', targetMode: 'PRO' })).rejects.toThrow('crash-before-target')
    const reserved = f.store.read('reservation')!
    expect(reserved.status).toBe('prepared')
    expect(existsSync(getSessionPath(f.root, reserved.targetSessionId!))).toBe(false)
    f.manager.createSession = create
    const apply = f.internal.applyHandoverInput.bind(f.manager)
    f.internal.applyHandoverInput = async (...args: unknown[]) => { await apply(...args); throw new Error('crash-after-input') }
    await expect(f.manager.handoverSession(f.source.id, { type: 'get', handoverId: 'reservation' })).rejects.toThrow('crash-after-input')
    expect(f.store.read('reservation')?.status).toBe('created')
    expect(loadSession(f.root, reserved.targetSessionId!)?.messages.filter(message => message.id === 'handover-reservation')).toHaveLength(1)
    await f.manager.flushAllSessions()
    restarted = new SessionManager()
    ;(restarted as any).loadSessionsFromDisk()
    const recovered = (await restarted.handoverSession(f.source.id, { type: 'get', handoverId: 'reservation' })).records[0]!
    expect(recovered.targetSessionId).toBe(reserved.targetSessionId)
    expect(recovered.status).toBe('applied')
    expect(loadSession(f.root, reserved.targetSessionId!)?.messages.filter(message => message.id === 'handover-reservation')).toHaveLength(1)
    const target = (restarted as any).sessions.get(reserved.targetSessionId!)
    const file = recovered.snapshot!.files[0]!
    writeFileSync(join(getSessionPath(f.root,target.id),'data','handover','reservation',file.snapshotPath),'tampered')
    expect(() => (restarted as any).handoverInput(target)).toThrow('integrity')
    const backwards = { ...recovered, status: 'waiting' as const }
    expect(() => f.store.save(backwards)).toThrow('transition')
    const foreign = { ...recovered, snapshot: { ...recovered.snapshot!, source: { ...recovered.snapshot!.source, sessionId: 'someone-else' } } }
    writeFileSync(join(f.store.directory('reservation'),'record.json'),JSON.stringify(foreign))
    expect(() => f.store.read('reservation')).toThrow('owner mismatch')
  } finally { if (restarted) { await restarted.flushAllSessions(); restarted.cleanup() }; await f.cleanup() }
})

test('actual SDK arguments override display-relative read paths and completed operation identity', async () => {
  const { handoverBranch, handoverOperationHash, handoverToolInputs, buildHandoverSnapshot } = await import('./handover-snapshot')
  const entries = [{ type: 'session', id: 'sdk', version: 3, cwd: '/real' },
    { type: 'message', id: 'call', parentId: null, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'write', name: 'write', arguments: { path: '/real/result.txt', content: 'done' } }] } }]
  const branch = handoverBranch(Buffer.from(entries.map(entry => JSON.stringify(entry)).join('\n')))
  expect(handoverToolInputs(branch).get('write')?.path).toBe('/real/result.txt')
  const snapshot = buildHandoverSnapshot({ workspaceId: 'w', sessionId: 's', targetMode: 'PRO', checkpoint: 'cp', branch, children: [], pendingOperations: [], runs: [], messages: [{ id: 'tool', role: 'tool', content: 'completed', timestamp: 1, toolUseId: 'write', toolName: 'Write', toolStatus: 'completed', toolInput: { file_path: './result.txt', content: 'done' } }] })
  expect(snapshot.actions[0]?.requestHash).toBe(handoverOperationHash('Write', { file_path: '/real/result.txt', content: 'done', _intent: 'display only' }))
  expect(() => handoverBranch(Buffer.from(JSON.stringify({ type: 'message', id: 'lost', parentId: 'missing' })))).toThrow('incomplete')
})

test('URL changes are checked explicitly without replacing its frozen response', async () => {
  const f = await fixture()
  const url = 'https://example.com/selection-handover-test'
  const fetcher = spyOn(globalThis,'fetch').mockImplementation(Object.assign(async () => new Response('changed web content', { headers: { 'Content-Type': 'text/plain' } }), { preconnect: () => {} }))
  try {
    f.source.messages.push({ id: 'web', role: 'tool', toolUseId: 'fetch', toolName: 'WebFetch', toolInput: { url }, toolStatus: 'completed', content: 'read page', toolResult: `Content from ${url}:\n\noriginal web content`, timestamp: 4 })
    const record = (await f.manager.handoverSession(f.source.id,{type:'create',handoverId:'web-source',targetMode:'PRO'})).records[0]!
    expect(fetcher).not.toHaveBeenCalled()
    const web = record.snapshot!.files.find(file => file.sourceUrl === url)!
    expect(web).toBeDefined()
    const checked = await f.manager.handoverSession(record.targetSessionId!,{type:'get',handoverId:'web-source',checkSources:true})
    expect(checked.changes?.find(change=>change.ref===web.ref)?.state).toBe('changed')
    expect(readFileSync(join(getSessionPath(f.root,record.targetSessionId!),'data','handover','web-source',web.snapshotPath),'utf8')).toContain('original web content')
    expect(f.store.read('web-source')?.snapshot).toEqual(record.snapshot)
  } finally { fetcher.mockRestore(); await f.cleanup() }
})

test('another runtime owner prevents capture and does not start a second execution', async () => {
  const f = await fixture('PRO')
  const { acquireProjectLock } = await import('../reliability/project-lock')
  const release = acquireProjectLock(join(getSessionPath(f.root,f.source.id),'data','execution-owner'))
  try {
    await expect(f.manager.handoverSession(f.source.id,{type:'create',handoverId:'other-runtime',targetMode:'NORM'})).rejects.toThrow('another application')
    expect(f.store.read('other-runtime')?.status).toBe('waiting')
    expect(f.internal.sessions.size).toBe(1)
    expect(()=>f.manager.assertTaskRunAllowed(f.workspace.id,f.source.id)).toThrow('already active')
  } finally { release(); await f.cleanup() }
})

test('paused source ownership and committed artifact version remain with the original root', async () => {
  const f = await fixture('PRO')
  try {
    const { writeSpecRevision, appendRunLog, writeNodeOutput } = await import('@craft-agent/shared/tasks')
    f.source.taskSlug = 'source-plan'
    f.manager.setTaskRunnerLookup(() => ({ getRunHistory: (_slug: string, owner: string) => { expect(owner).toBe(f.source.id); return [{ runId: 'paused-run', revision: 0, status: 'paused' }] } }) as never)
    writeSpecRevision(f.root,'source-plan','paused-run',0,{ schema_version:3, id:'source-plan',title:'原计划',goal:'原执行目标',runner:'conduct',nodes:[{id:'a',prompt:'read'}] } as never)
    appendRunLog(f.root,'source-plan','paused-run',{kind:'node-scheduled',nodeId:'a',at:1,revision:0} as never)
    appendRunLog(f.root,'source-plan','paused-run',{kind:'node-finished',nodeId:'a',state:'done',at:2,revision:0} as never)
    writeNodeOutput(f.root,'source-plan','paused-run','a',{text:'original result',params:{report:{path:'costs.txt',hash:f.artifact.versions[0]!.hash,mime:'text/plain',size:Buffer.byteLength(readFileSync(f.file))}}} as never)
    // The current file changes; the committed artifact bytes can still be recovered from its registered version.
    writeFileSync(f.file,'later draft')
    const record = (await f.manager.handoverSession(f.source.id,{type:'create',handoverId:'paused-plan',targetMode:'NORM'})).records[0]!
    expect(record.snapshot!.runs[0]?.retainedBy).toBe(f.source.id)
    expect(record.snapshot!.goal).toContain('原执行目标')
    const target = f.internal.sessions.get(record.targetSessionId!)
    expect(()=>f.internal.assertHandoverOperationAllowed(target,'run_task',{slug:'source-plan'})).toThrow('ownership')
    const artifact = record.snapshot!.files.find(file=>file.versionId===f.artifact.currentVersion)!
    expect(readFileSync(join(getSessionPath(f.root,target.id),'data','handover',record.handoverId,artifact.snapshotPath),'utf8')).toContain('1000000')
    const next = (await f.manager.handoverSession(target.id,{type:'create',handoverId:'paused-next',targetMode:'PRO'})).records[0]!
    expect(next.snapshot!.runs.some(run=>run.retainedBy===f.source.id)).toBe(true)
    expect(()=>f.manager.assertTaskRunAllowed(f.workspace.id,next.targetSessionId!,{slug:'source-plan'})).toThrow('ownership')
  } finally { await f.cleanup() }
})
