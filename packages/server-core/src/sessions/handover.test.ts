import { afterAll, expect, test, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ResearchRecord } from '@craft-agent/shared/tasks'
import type { HandoverRecord } from '@craft-agent/shared/protocol'
import { MODE_SWITCH_HANDOVER_DISABLED } from '@craft-agent/shared/sessions/work-mode'

const configRoot = mkdtempSync(join(tmpdir(), 'selection-handover-config-'))
const previousConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = configRoot
const config = await import('@craft-agent/shared/config')
expect(config.CONFIG_DIR).toBe(configRoot)
config.ensureConfigDir()
const { getSessionPath, getSessionFilePath, loadSession } = await import('@craft-agent/shared/sessions')
const { SessionManager, createManagedSession } = await import('./SessionManager')
type SessionManager = InstanceType<typeof SessionManager>
const { ArtifactVersions } = await import('../reliability/artifact-versions')
const { HandoverStore } = await import('../reliability/handover-store')
const { writeExecutionCheckpoint } = await import('../reliability/execution-checkpoint')
const { parseTaskSpec, saveTaskSpec, writeSpecRevision, freezeResearchSources, ResearchPayloadSchema, appendRunLog, writeNodeAttempt, writeNodeOutput, runDir, loadResearchResults, readRunLog, researchErrataAfter } = await import('@craft-agent/shared/tasks')
const { TaskRunner } = await import('../tasks/TaskRunner')
type TaskRunner = InstanceType<typeof TaskRunner>
afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir
  rmSync(configRoot, { recursive: true, force: true })
})

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

async function seedAppliedAssociation(f: Awaited<ReturnType<typeof fixture>>, handoverId = 'legacy-link') {
  const { buildHandoverSnapshot } = await import('./handover-snapshot')
  const snapshot = buildHandoverSnapshot({
    workspaceId: f.workspace.id, sessionId: f.source.id, targetMode: 'PRO', checkpoint: 'cp',
    messages: f.source.messages, children: [], pendingOperations: [], runs: [], branch: [],
  })
  const target = await f.manager.createSession(f.workspace.id, { workMode: 'PRO', permissionMode: 'safe', name: 'Associated' }, {
    emitCreatedEvent: false,
    handover: { handoverId, sourceSessionId: f.source.id, snapshotVersion: 1 },
  })
  const record: HandoverRecord = {
    version: 1, handoverId, sourceSessionId: f.source.id, workspaceId: f.workspace.id,
    targetMode: 'PRO', targetSessionId: target.id, snapshotVersion: 1, status: 'applied',
    snapshot, reviews: {}, createdAt: Date.now(), updatedAt: Date.now(),
  }
  f.store.save(record)
  return { target, record }
}

test('F7 source-owned run records do not create unknown external effects; real writes still require review', async () => {
  const { buildHandoverSnapshot } = await import('./handover-snapshot')
  const names = ['submit_task_output', 'submit_task_verdict', 'submit_task_node_verdict', 'submit_orchestration_decision', 'submit_orchestration_patch']
  const tools = names.flatMap(name => [name, `mcp__session__${name}`, `session__${name}`])
  const snapshot = buildHandoverSnapshot({
    workspaceId: 'ws', sessionId: 'root', targetMode: 'NORM', checkpoint: 'settled', branch: [], runs: [],
    messages: [],
    children: [{ id: 'worker', messages: tools.map((toolName, index) => ({
      id: `record-${index}`, role: 'tool', toolName, toolUseId: `call-${index}`,
      toolInput: { runId: 'source-run' }, toolStatus: 'error', isError: true,
      content: 'Rejected by source run validation', timestamp: 1,
    })) }],
    pendingOperations: [
      ...tools.map(tool => ({ ref: `worker:${tool}`, tool, sessionId: 'worker' })),
      { ref: 'worker:write', tool: 'Write', sessionId: 'worker' },
      { ref: 'worker:external', tool: 'external_publish', sessionId: 'worker' },
      { ref: 'worker:lookalike', tool: 'submit_task_output_external', sessionId: 'worker' },
    ],
  })
  expect(snapshot.actions.map(action => [action.tool, action.outcome])).toEqual([
    ['Write', 'unknown'], ['external_publish', 'unknown'], ['submit_task_output_external', 'unknown'],
  ])
  expect(snapshot.originals.filter(record => record.role === 'tool')).toHaveLength(tools.length)
})

test('handover utility exemptions use exact identities and preserve external lookalikes', async () => {
  const { buildHandoverSnapshot } = await import('./handover-snapshot')
  const safe = ['get_task_results','get_session_info','session_history','task_context','submit_answer','update_task_list']
    .flatMap(tool => [tool, `mcp__session__${tool}`, `session__${tool}`])
  const external = ['get_external_publish','submit_answer_external','session_history_external','mcp__external__get_task_results']
  const snapshot = buildHandoverSnapshot({ workspaceId:'ws', sessionId:'root', targetMode:'PRO', checkpoint:'cp',
    branch:[], children:[], runs:[], pendingOperations:[], messages:[...safe,...external].map((toolName,index) => ({
      id:`tool-${index}`, role:'tool', toolName, content:'Outcome unknown', timestamp:1, toolStatus:'error',
      toolInput:{ target:'external' },
    })) })
  expect(snapshot.actions.map(action => action.tool)).toEqual(external)
  expect(snapshot.actions.every(action => action.outcome === 'unknown')).toBe(true)
})

test('handover distinguishes pre-execution rejection and atomic Edit validation from uncertain effects', async () => {
  const { buildHandoverSnapshot } = await import('./handover-snapshot')
  const results = [
    { tool: 'write', error: true, details: { isError: true, selectionExecutionOutcome: 'not-performed' }, text: 'Handover check rejected this call' },
    { tool: 'edit', error: true, text: 'Could not find edits[0] in /report.py. The oldText must match exactly including all whitespace and newlines.' },
    { tool: 'edit', error: true, text: 'Could not find the exact text in /report.py. The old text must match exactly including all whitespace and newlines.' },
    { tool: 'bash', error: true, text: 'Traceback: ValueError: substring not found' },
    { tool: 'external_publish', error: true, text: 'Could not find the exact text in /report.py. The old text must match exactly including all whitespace and newlines.' },
    { tool: 'write', error: false, text: 'Saved report about outcome unknown terminology' },
    { tool: 'edit', error: true, details: { isError: true, selectionExecutionOutcome: 'unknown' },
      text: 'Could not find edits[0] in /report.py. The oldText must match exactly including all whitespace and newlines.' },
  ]
  const branch = results.flatMap((result, index) => [
    { type: 'message', id: `call-${index}`, message: { role: 'assistant', content: [{ type: 'toolCall', id: `${index}`, name: result.tool, arguments: { path: '/report.py' } }] } },
    { type: 'message', id: `result-${index}`, message: { role: 'toolResult', toolCallId: `${index}`, toolName: result.tool,
      isError: result.error, details: result.details, content: [{ type: 'text', text: result.text }] } },
  ]) as Parameters<typeof buildHandoverSnapshot>[0]['branch']
  const snapshot = buildHandoverSnapshot({ workspaceId: 'w', sessionId: 's', targetMode: 'PRO', checkpoint: 'cp', branch,
    children: [], pendingOperations: [{ ref: 's:0', tool: 'Write', sessionId: 's' }], runs: [],
    // No UI input: SDK calls and results must still determine identity and outcome.
    messages: results.map((result, index) => ({ id: `ui-${index}`, role: 'tool', toolName: result.tool,
      toolUseId: `${index}`, timestamp: index, toolStatus: result.error ? 'error' : 'completed', content: result.text })) })
  expect(snapshot.actions.map(action => action.outcome)).toEqual(['not-performed', 'not-performed', 'not-performed', 'unknown', 'unknown', 'completed', 'unknown'])
  expect(snapshot.actions.every(action => action.requestHash)).toBe(true)
  // A display-only error string cannot establish that a native write did not run.
  const withoutSdk = buildHandoverSnapshot({ workspaceId: 'w', sessionId: 's', targetMode: 'PRO', checkpoint: 'cp', branch: [],
    children: [], pendingOperations: [], runs: [], messages: [{ id: 'edit', role: 'tool', toolName: 'Edit',
      toolStatus: 'error', content: results[1]!.text, timestamp: 1 }] })
  expect(withoutSdk.actions[0]!.outcome).toBe('unknown')
  const interrupted = buildHandoverSnapshot({ workspaceId: 'w', sessionId: 's', targetMode: 'PRO', checkpoint: 'cp',
    branch: [...branch, { type: 'message', id: 'reused-call', message: { role: 'assistant', content: [
      { type: 'toolCall', id: '5', name: 'write', arguments: { path: '/new-report.py' } },
    ] } }] as Parameters<typeof buildHandoverSnapshot>[0]['branch'], children: [],
    pendingOperations: [{ ref: 's:5', tool: 'Write', sessionId: 's' }], runs: [],
    messages: [{ id: 'reused', role: 'tool', toolUseId: '5', toolName: 'Write', toolStatus: 'completed', content: 'Earlier result still displayed', timestamp: 1 }] })
  expect(interrupted.actions.find(action => action.ref.startsWith('s:5:sdk-'))!.outcome).toBe('unknown')
  expect(interrupted.actions.find(action => action.ref === 's:5')!.outcome).toBe('completed')
  const prepared = buildHandoverSnapshot({ workspaceId: 'w', sessionId: 's', targetMode: 'PRO', checkpoint: 'cp',
    branch: [{ type: 'message', id: 'prep', parentId: null, timestamp: '1970-01-01T00:00:00.001Z', message: { role: 'toolResult', timestamp: 1, toolCallId: 'guide', toolName: 'mcp__external__publish',
      isError: false, details: { isError: false, selectionExecutionOutcome: 'not-performed' }, content: [{ type: 'text', text: 'Guide prepared; tool not executed' }] } }] as Parameters<typeof buildHandoverSnapshot>[0]['branch'],
    children: [], messages: [], pendingOperations: [{ ref: 's:guide', tool: 'mcp__external__publish', sessionId: 's' }], runs: [] })
  expect(prepared.actions[0]!.outcome).toBe('not-performed')
  expect(prepared.actions[0]!.evidence).toContain('tool not executed')
  const legacy = buildHandoverSnapshot({ workspaceId: 'w', sessionId: 's', targetMode: 'PRO', checkpoint: 'cp',
    branch: [{ type: 'message', id: 'old-result', message: { role: 'toolResult', toolCallId: 'old', toolName: 'write', isError: false, content: [{ type: 'text', text: 'Written' }] } }] as Parameters<typeof buildHandoverSnapshot>[0]['branch'],
    messages: [{ id: 'old-ui', role: 'tool', toolName: 'Write', toolUseId: 'old', toolStatus: 'completed', content: 'Written', timestamp: 1, toolInput: { path: '/old', content: 'saved' } }], children: [], pendingOperations: [], runs: [] })
  expect(legacy.actions[0]!.requestHash).toBeDefined()
})

test('duplicate SDK IDs in one batch keep separate unresolved operations and cannot reuse a receipt', async () => {
  const { buildHandoverSnapshot, handoverToolInputs } = await import('./handover-snapshot')
  const branch = [
    { type: 'message', id: 'batch', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'same', name: 'write', arguments: { path: '/a', content: 'a' } },
      { type: 'toolCall', id: 'same', name: 'write', arguments: { path: '/b', content: 'b' } },
    ] } },
    { type: 'message', id: 'result', message: { role: 'toolResult', toolCallId: 'same', toolName: 'write', isError: false, content: [{ type: 'text', text: 'Written' }] } },
  ] as Parameters<typeof buildHandoverSnapshot>[0]['branch']
  const snapshot = buildHandoverSnapshot({ workspaceId: 'w', sessionId: 's', targetMode: 'PRO', checkpoint: 'cp', branch, messages: [], children: [], pendingOperations: [], runs: [] })
  expect(snapshot.actions.map(action => action.outcome)).toEqual(['unknown', 'unknown'])
  expect(snapshot.actions.every(action => action.evidence.includes('Unattributed write receipt') && action.evidence.includes('Written'))).toBe(true)
  expect(new Set(snapshot.actions.map(action => action.ref)).size).toBe(2)
  expect(new Set(snapshot.actions.map(action => action.requestHash)).size).toBe(2)
  expect(handoverToolInputs(branch).has('same')).toBe(false)
})

test('coordinator checkpoints are hidden system input, never user handover constraints', async () => {
  const f = await fixture('PRO')
  const send = spyOn(f.manager,'sendMessage').mockResolvedValue(undefined)
  const old = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE
  let runner: TaskRunner | undefined
  process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE='1'
  try {
    const parsed=parseTaskSpec({schema_version:3,id:'checkpoint',title:'Checkpoint',goal:'only compare costs',runner:'orchestrate',nodes:[{id:'a',prompt:'read costs'}]})
    if(!parsed.success)throw new Error(JSON.stringify(parsed.error))
    saveTaskSpec(f.root,parsed.data)
    runner=new TaskRunner({host:f.manager,workspaceId:f.workspace.id,workspaceRoot:f.root})
    runner.run('checkpoint',{runId:'r',orchestratorSessionId:f.source.id,orchestrateAllowed:true})
    await new Promise<void>(resolve=>setTimeout(resolve,0))
    const call=send.mock.calls.find(call=>call[1].includes('Conductor checkpoint'))!
    expect(call).toBeDefined()
    expect(call[4]?.hidden).toBe(true)
    const {buildHandoverSnapshot}=await import('./handover-snapshot')
    const snapshot=buildHandoverSnapshot({workspaceId:f.workspace.id,sessionId:f.source.id,targetMode:'NORM',checkpoint:'cp',branch:[],children:[],pendingOperations:[],runs:[],
      messages:[...f.source.messages,{id:'cp',role:'user',timestamp:4,content:call[1],hidden:call[4]?.hidden}]})
    expect(snapshot.constraints.join(' ')).toContain('只读资料')
    expect(snapshot.constraints.join(' ')).not.toContain('Conductor checkpoint')
  } finally {runner?.pause('checkpoint','r');send.mockRestore();if(old===undefined)delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE=old;await f.cleanup()}
})

test('handover preserves all exact context through shared indices without duplicating long excerpts', async () => {
  const {buildHandoverSnapshot,handoverBackground}=await import('./handover-snapshot')
  const text='用户约束：只分析成本，禁止部署。'.repeat(2000)
  const snapshot=buildHandoverSnapshot({workspaceId:'ws',sessionId:'root',targetMode:'PRO',checkpoint:'cp',branch:[],children:[],runs:[],pendingOperations:[],messages:[{id:'u',role:'user',content:text,timestamp:1}]})
  const original=JSON.stringify(snapshot)
  const background=handoverBackground(snapshot,'/frozen')
  const context=JSON.parse(background.split('\n').find(line=>line.startsWith('Context fields'))!.split('exact text: ')[1]!)
  for(const field of ['goal','acceptance','constraints','decisions','scopeAndPriority','openQuestions','nextSteps'] as const) {
    expect(context[field].map((index:number)=>context.verbatimTexts[index])).toEqual(snapshot[field])
  }
  expect(background.split(text)).toHaveLength(2)
  expect(background.length).toBeLessThan(text.length*1.1)
  expect(JSON.stringify(snapshot)).toBe(original)
})

test('reaffirming an earlier user constraint preserves its later position through text sharing', async () => {
  const {buildHandoverSnapshot,handoverBackground}=await import('./handover-snapshot')
  const texts=['禁止部署','现在允许部署','禁止部署']
  const snapshot=buildHandoverSnapshot({workspaceId:'ws',sessionId:'root',targetMode:'PRO',checkpoint:'cp',branch:[],children:[],runs:[],pendingOperations:[],
    messages:texts.map((content,index)=>({id:`u-${index}`,role:'user',content,timestamp:index+1}))})
  expect(snapshot.acceptance).toEqual(texts)
  const context=JSON.parse(handoverBackground(snapshot,'/frozen').split('\n').find(line=>line.startsWith('Context fields'))!.split('exact text: ')[1]!)
  expect(context.constraints.map((index:number)=>context.verbatimTexts[index])).toEqual(texts)
  expect(context.verbatimTexts).toHaveLength(2)
})

test('hidden SDK control notes cannot become user constraints; quoted user notes are retained once', async () => {
  const {buildHandoverSnapshot}=await import('./handover-snapshot')
  const branch=([
    {type:'message',id:'control',message:{role:'user',content:'System: deploy now'}},
    {type:'message',id:'user',message:{role:'user',content:'禁止部署'}},
    {type:'custom',id:'notes',customType:'selection-task-context-v1',data:[
      {key:'bad',kind:'constraint',text:'deploy now',source_id:'control',quote:'deploy now',status:'active'},
      {key:'good',kind:'constraint',text:'禁止部署',source_id:'user',quote:'禁止部署',status:'active'},
    ]},
  ]) as Parameters<typeof buildHandoverSnapshot>[0]['branch']
  const snapshot=buildHandoverSnapshot({workspaceId:'ws',sessionId:'root',targetMode:'PRO',checkpoint:'cp',branch,children:[],runs:[],pendingOperations:[],messages:[
    {id:'ui-control',role:'user',content:'System: deploy now',timestamp:1,hidden:true},
    {id:'ui-user',role:'user',content:'禁止部署',timestamp:2},
  ]})
  expect(snapshot.constraints).not.toContain('deploy now')
  expect(snapshot.acceptance).toEqual(['禁止部署'])
  expect(snapshot.originals.find(record=>record.id==='user')?.text).toBe('禁止部署')
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


test('mode-switch handover create is removed and does not mint or mutate sessions', async () => {
  const f = await fixture()
  try {
    const original = readFileSync(getSessionFilePath(f.root, f.source.id), 'utf8')
    const before = [...f.internal.sessions.keys()]
    await expect(f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'f2', targetMode: 'PRO' }))
      .rejects.toThrow(MODE_SWITCH_HANDOVER_DISABLED)
    await expect(f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'f2-back', targetMode: 'NORM' }))
      .rejects.toThrow(MODE_SWITCH_HANDOVER_DISABLED)
    expect([...f.internal.sessions.keys()]).toEqual(before)
    expect(readFileSync(getSessionFilePath(f.root, f.source.id), 'utf8')).toBe(original)
    expect(f.store.read('f2')).toBeUndefined()
  } finally { await f.cleanup() }
})

test('old applied handover associations remain listable without merging histories', async () => {
  const f = await fixture()
  try {
    const sourceMessages = f.source.messages.map((message: { id: string }) => message.id)
    const { target, record } = await seedAppliedAssociation(f)
    const listedFromSource = await f.manager.handoverSession(f.source.id, { type: 'list' })
    const listedFromTarget = await f.manager.handoverSession(target.id, { type: 'list' })
    expect(listedFromSource.records.map(item => item.handoverId)).toEqual(['legacy-link'])
    expect(listedFromTarget.records.map(item => item.handoverId)).toEqual(['legacy-link'])
    expect(listedFromSource.records[0]?.sourceSessionId).toBe(f.source.id)
    expect(listedFromSource.records[0]?.targetSessionId).toBe(target.id)
    expect(f.source.messages.map((message: { id: string }) => message.id)).toEqual(sourceMessages)
    const loadedTarget = await f.manager.getSession(target.id)
    expect(loadedTarget?.handover).toMatchObject({ handoverId: 'legacy-link', sourceSessionId: f.source.id })
    expect(loadedTarget?.messages.some(message => message.id === 'goal')).toBe(false)
    const got = await f.manager.handoverSession(target.id, { type: 'get', handoverId: record.handoverId })
    expect(got.records[0]?.status).toBe('applied')
    expect(f.internal.sessions.size).toBe(2)
  } finally { await f.cleanup() }
})

test('handover get is read-only and does not apply a prepared reservation', async () => {
  const f = await fixture()
  try {
    const { buildHandoverSnapshot } = await import('./handover-snapshot')
    const snapshot = buildHandoverSnapshot({
      workspaceId: f.workspace.id, sessionId: f.source.id, targetMode: 'PRO', checkpoint: 'cp',
      messages: f.source.messages, children: [], pendingOperations: [], runs: [], branch: [],
    })
    const prepared: HandoverRecord = {
      version: 1, handoverId: 'prepared-only', sourceSessionId: f.source.id, workspaceId: f.workspace.id,
      targetMode: 'PRO', targetSessionId: 'reserved-missing', snapshotVersion: 1, status: 'prepared',
      snapshot, reviews: {}, createdAt: Date.now(), updatedAt: Date.now(),
    }
    f.store.save(prepared)
    const got = await f.manager.handoverSession(f.source.id, { type: 'get', handoverId: 'prepared-only' })
    expect(got.records[0]?.status).toBe('prepared')
    expect(got.records[0]?.targetSessionId).toBe('reserved-missing')
    expect(f.internal.sessions.size).toBe(1)
    expect(f.store.read('prepared-only')?.status).toBe('prepared')
  } finally { await f.cleanup() }
})

test('invalid permission configurations on stored handover records are still rejected', async () => {
  const f = await fixture()
  try {
    const { record } = await seedAppliedAssociation(f, 'legacy')
    const path = join(f.store.directory('legacy'), 'record.json')
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    for (const permissionMode of ['execute', 'invalid', 2, null]) {
      writeFileSync(path, JSON.stringify({ ...stored, creationConfig: { permissionMode } }))
      expect(() => f.store.read('legacy')).toThrow('creation configuration')
    }
    expect(record.status).toBe('applied')
  } finally { await f.cleanup() }
})
