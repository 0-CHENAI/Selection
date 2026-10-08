import { afterAll, expect, test, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ResearchRecord } from '@craft-agent/shared/tasks'

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

test('large and legacy handovers expose readable operation evidence without changing their immutable receipt', async () => {
  const f = await fixture()
  try {
    f.source.messages.push({ id: 'large', role: 'assistant', content: 'x'.repeat(260_000), timestamp: 4 },
      { id: 'uncertain', role: 'tool', toolName: 'Bash', toolUseId: 'uncertain', toolInput: { command: 'publish' },
        toolStatus: 'error', content: `Outcome unknown; check publication receipt\n${'中文证据😀\\"\n'.repeat(10_000)}`, timestamp: 5 })
    const record = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'large-input', targetMode: 'PRO' })).records[0]!
    const target = f.internal.sessions.get(record.targetSessionId!)
    const directory = join(getSessionPath(f.root, target.id), 'data', 'handover', record.handoverId)
    const operationPath = join(directory, 'operations.json')
    const immutable = readFileSync(join(f.store.directory(record.handoverId), 'record.json'), 'utf8')
    const { createReadToolDefinition } = await import('@earendil-works/pi-coding-agent')
    const read = createReadToolDefinition(f.root)
    const result = await read.execute('inspect', { path: operationPath }, undefined, undefined, {} as never)
    expect(JSON.stringify(result.content)).toContain('check publication receipt')
    expect(JSON.stringify(result.content)).not.toContain('exceeds')
    // Existing minified snapshots get the same derived index on the next turn.
    writeFileSync(join(directory, 'snapshot.json'), JSON.stringify(record.snapshot))
    rmSync(operationPath)
    expect(f.internal.handoverInput(target)).toContain('operations.json')
    const evidence = JSON.parse(readFileSync(operationPath, 'utf8'))
    expect(evidence.map((action: { evidenceChunks: string[] }) => action.evidenceChunks.join(''))).toEqual(record.snapshot!.actions.map(action => action.evidence))
    expect(readFileSync(operationPath, 'utf8').split('\n').every(line => Buffer.byteLength(line) < 50 * 1024)).toBe(true)
    expect(readFileSync(join(f.store.directory(record.handoverId), 'record.json'), 'utf8')).toBe(immutable)
    const indexed = readFileSync(operationPath, 'utf8')
    writeFileSync(operationPath, JSON.stringify(record.snapshot!.actions, null, 2))
    expect(f.internal.handoverInput(target)).toContain('evidenceChunks')
    expect(readFileSync(operationPath, 'utf8')).toBe(indexed)
    writeFileSync(operationPath, '[]')
    expect(() => f.internal.handoverInput(target)).toThrow('operation evidence integrity')
    writeFileSync(join(directory, 'snapshot.json'), '{}')
    expect(() => f.internal.handoverInput(target)).toThrow('background integrity')
  } finally { await f.cleanup() }
})

test('SDK call occurrences retain separate identities and completed operations without UI messages', async () => {
  const f = await fixture()
  try {
    const { SessionManager: PiSessionManager } = await import('@earendil-works/pi-coding-agent')
    const sdk = PiSessionManager.create(f.root, join(getSessionPath(f.root, f.source.id), '.pi-sessions'))
    f.source.sdkSessionId = sdk.getSessionId()
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    const calls = [
      { id: 'reused', tool: 'write', args: { path: '/first.txt', content: 'first' }, outcome: 'completed', text: 'First write completed' },
      { id: 'reused', tool: 'write', args: { path: '/second.txt', content: 'second' }, outcome: 'not-performed', text: 'Second write rejected before execution' },
      { id: 'hidden', tool: 'external_publish', args: { target: 'original' }, outcome: 'completed', text: 'Publication confirmed' },
      { id: 'fetch', tool: 'web_fetch', args: { url: 'https://example.com/first' }, outcome: 'completed', text: 'First original page' },
      { id: 'fetch', tool: 'web_fetch', args: { url: 'https://example.com/second' }, outcome: 'completed', text: 'Second original page' },
    ] as const
    for (const call of calls) {
      sdk.appendMessage({ role: 'assistant', api: 'openai-responses', provider: 'openai', model: 'fixture', usage, stopReason: 'toolUse', timestamp: 1,
        content: [{ type: 'toolCall', id: call.id, name: call.tool, arguments: call.args }] })
      sdk.appendMessage({ role: 'toolResult', toolCallId: call.id, toolName: call.tool, timestamp: 2, isError: call.outcome === 'not-performed',
        details: { selectionExecutionOutcome: call.outcome }, content: [{ type: 'text', text: call.text }] })
    }
    sdk.appendMessage({ role: 'toolResult', toolCallId: 'legacy-fetch', toolName: 'web_fetch', timestamp: 3, isError: false,
      content: [{ type: 'text', text: 'Legacy original page' }] })
    // The UI merges repeated IDs and has no entry for the hidden publication.
    f.source.messages.push({ id: 'last-write', role: 'tool', toolName: 'Write', toolUseId: 'reused', toolStatus: 'error', content: calls[1].text, timestamp: 4 })
    f.source.messages.push({ id: 'last-fetch', role: 'tool', toolName: 'WebFetch', toolUseId: 'fetch', toolStatus: 'completed', content: 'Last displayed page', timestamp: 5 })
    f.source.messages.push({ id: 'legacy-fetch-ui', role: 'tool', toolName: 'WebFetch', toolUseId: 'legacy-fetch', toolInput: { url: 'https://example.com/legacy' }, toolStatus: 'completed', content: 'Legacy displayed page', timestamp: 6 })
    const record = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'call-occurrences', targetMode: 'PRO' })).records[0]!
    const actions = record.snapshot!.actions
    expect(actions).toHaveLength(3)
    expect(new Set(actions.map(action => action.ref)).size).toBe(3)
    expect(actions.map(action => action.outcome)).toEqual(['completed', 'not-performed', 'completed'])
    const target = f.internal.sessions.get(record.targetSessionId!)
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'Write', { file_path: '/first.txt', content: 'first' })).toThrow('already completed')
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'Write', { file_path: '/second.txt', content: 'second' })).not.toThrow()
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'external_publish', { target: 'original' })).toThrow('already completed')
    const pages = record.snapshot!.files.filter(file => file.sourceUrl)
    expect(pages).toHaveLength(3)
    expect(pages.map(page => page.sourceUrl)).toEqual(['https://example.com/first', 'https://example.com/second', 'https://example.com/legacy'])
    expect(pages.map(page => f.store.snapshotBytes(record.handoverId, page.snapshotPath, page.hash).toString('utf8'))).toEqual(['First original page', 'Second original page', 'Legacy original page'])
  } finally { await f.cleanup() }
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

test('a reviewed operation without request arguments blocks its aliases from replay', async () => {
  const f=await fixture()
  try {
    f.source.messages.push({id:'unknown',role:'tool',toolName:'write',toolUseId:'write',toolStatus:'error',content:'Outcome unknown',timestamp:4})
    const record=(await f.manager.handoverSession(f.source.id,{type:'create',handoverId:'no-args',targetMode:'PRO'})).records[0]!
    const action=record.snapshot!.actions[0]!
    expect(action.requestHash).toBeUndefined()
    const target=f.internal.sessions.get(record.targetSessionId!)
    for(const tool of ['get_task_results','session__get_task_results','mcp__session__get_task_results','session__submit_answer']) {
      expect(()=>f.internal.assertHandoverOperationAllowed(target,tool,{})).not.toThrow()
    }
    await f.manager.handoverSession(target.id,{type:'review',handoverId:'no-args',actionRef:action.ref,outcome:'completed',note:'Verified that the write completed; original arguments unavailable.'})
    expect(()=>f.internal.assertHandoverOperationAllowed(target,'Write',{file_path:f.file,content:'retry'})).toThrow('request identity is unavailable')
  } finally {await f.cleanup()}
})

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

test('A3 later canonical corrections reach existing handovers without rewriting snapshots; corrupt receipts are disclosed', async () => {
  const f = await fixture('PRO')
  try {
    const parsed = parseTaskSpec({ schema_version: 3, id: 'research', title: 'Research', goal: 'cost', research: {
      line: { id: 'main', question: 'cost' }, dimensions: [{ id: 'cost', requirement: 'original cost' }], sources: [{ id: 's', path: 'costs.txt' }],
    }, nodes: ['researcher', 'reviewer', 'reporter'].map(role => ({ id: role, researchRole: role, prompt: role, outputs: [{ name: 'research', kind: 'param', type: 'json', required: true }] })) })
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error))
    const spec = parsed.data
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
    function start(runId: string, predecessor?: string, owner = f.source.id) {
      writeSpecRevision(f.root, 'research', runId, 0, spec)
      const sources = freezeResearchSources(f.root, 'research', runId, spec.research!, f.root)
      const previous = predecessor ? loadResearchResults(f.root, 'research', predecessor)! : undefined
      appendRunLog(f.root, 'research', runId, { t: new Date().toISOString(), kind: 'run-started', taskId: 'research', runId, orchestratorSessionId: owner, resumedFrom: predecessor, researchSourcesHash: digest(sources),
        researchPredecessor: previous ? { runId: predecessor!, recordsHash: digest(previous.records), readsHash: digest(previous.reads) } : undefined })
      return sources
    }
    function finish(runId: string, role: ResearchRecord['role'], raw: unknown) {
      const payload = ResearchPayloadSchema.parse(raw), output = { text: role, params: { research: payload } }
      writeNodeAttempt(f.root, 'research', runId, role, 1, output)
      const researchRecord: ResearchRecord = { role, payload, producedBy: { runId, nodeId: role, revision: 0, attempt: 1, sessionId: `${runId}-${role}`, artifactVersion: digest(output) } }
      appendRunLog(f.root, 'research', runId, { t: new Date().toISOString(), kind: 'node-finished', nodeId: role, sessionId: `${runId}-${role}`, state: 'done', researchRecord })
    }
    saveTaskSpec(f.root, parsed.data)
    const sources = start('original')
    finish('original', 'researcher', { evidence: [{ id: 'e', sourceId: 's', sourceVersion: sources[0]!.version, locator: { startLine: 1, endLine: 1 }, excerpt: readFileSync(f.file, 'utf8') }], claims: [{ id: 'cost', version: 1, type: 'fact', text: 'Cost 1000000', dimensionIds: ['cost'], evidenceIds: ['e'], critical: true }] })
    finish('original', 'reviewer', { reviews: [{ claimRef: { id: 'cost', version: 1 }, citationExists: true, support: 'supported', finding: 'Original reviewed' }] })
    finish('original', 'reporter', { report: { claimRefs: [{ id: 'cost', version: 1 }], limitations: [], unresolved: [] } })
    appendRunLog(f.root, 'research', 'original', { t: new Date().toISOString(), kind: 'run-completed' })
    f.source.taskSlug = 'research'; f.internal.persistSession(f.source)
    f.manager.setTaskRunnerLookup(() => new TaskRunner({ host: f.manager, workspaceId: f.workspace.id, workspaceRoot: f.root }))
    const record = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'late-erratum', targetMode: 'NORM' })).records[0]!
    const target = f.internal.sessions.get(record.targetSessionId!)
    const snapshotPath = join(getSessionPath(f.root, target.id), 'data', 'handover', record.handoverId, 'snapshot.json')
    const frozen = readFileSync(snapshotPath, 'utf8'), stored = readFileSync(join(f.store.directory(record.handoverId), 'record.json'), 'utf8')
    expect(record.snapshot!.runs[0]!.logSequence).toBe(5)
    expect((await f.manager.handoverSession(target.id, { type: 'get', handoverId: record.handoverId })).researchUpdates).toEqual([])
    const erratum = { id: 'cost-limit', target: { kind: 'claim', claimRef: { id: 'cost', version: 1 } }, reason: 'Previously omitted cost boundary requires revision' }
    start('successor', 'original'); finish('successor', 'reviewer', { errata: [erratum] })
    appendRunLog(f.root, 'research', 'successor', { t: new Date().toISOString(), kind: 'run-completed' })
    // An unrelated root cannot inject a correction into this source-owned history.
    start('unrelated', 'original', 'another-root'); finish('unrelated', 'reviewer', { errata: [{ ...erratum, id: 'foreign' }] })
    const updates = (await f.manager.handoverSession(target.id, { type: 'list' })).researchUpdates!
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ handoverId: record.handoverId, runId: 'successor', errata: [{ ...erratum, state: 'pending', affectedClaimRefs: [{ id: 'cost', version: 1 }] }] })
    expect(f.internal.handoverInput(target)).toContain(erratum.reason)
    // A sequence watermark excludes corrections already included in a snapshot, independent of clock drift.
    const seq = readRunLog(f.root, 'research', 'successor').length
    expect(researchErrataAfter(f.root, 'research', { runId: 'successor', retainedBy: f.source.id, logSequence: seq }, 0)).toEqual([])
    writeNodeAttempt(f.root, 'research', 'successor', 'reviewer', 1, { text: 'tampered' })
    const unavailable = (await f.manager.handoverSession(target.id, { type: 'get', handoverId: record.handoverId })).researchUpdates!
    expect(unavailable[0]!.unavailableReason).toContain('integrity is unavailable')
    expect(f.internal.handoverInput(target)).toContain('Unavailable history does not establish')
    expect(readFileSync(snapshotPath, 'utf8')).toBe(frozen)
    expect(readFileSync(join(f.store.directory(record.handoverId), 'record.json'), 'utf8')).toBe(stored)
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

test('F2 handover preserves source, constraints, file versions and the chosen permission mode', async () => {
  const f = await fixture()
  try {
    const original = readFileSync(getSessionFilePath(f.root, f.source.id), 'utf8')
    const request = { type: 'create' as const, handoverId: 'f2', targetMode: 'PRO' as const }
    const first = (await f.manager.handoverSession(f.source.id, request)).records[0]!
    expect(first.status).toBe('applied')
    const target = await f.manager.getSession(first.targetSessionId!)
    expect(target).toMatchObject({ name: f.source.name, workMode: 'PRO', permissionMode: f.source.permissionMode, model: f.source.model })
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
    // The chat success bubble is restored from this persisted receipt, never a new user prompt.
    expect(loadSession(f.root, first.targetSessionId!)?.messages.find(message => message.id === 'handover-f2'))
      .toMatchObject({ type: 'info', hidden: true })
    expect(target?.messages.find(message => message.id === 'handover-f2')).toMatchObject({ role: 'info', hidden: true })
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
    expect(await f.manager.getSession(norm.targetSessionId!)).toMatchObject({ name: f.source.name, workMode: 'NORM', permissionMode: target?.permissionMode })
    expect(norm.snapshot?.constraints.join(' ')).toContain('不部署')
    expect(norm.snapshot?.files.some(file => file.versionId === f.artifact.currentVersion)).toBe(true)
  } finally { await f.cleanup() }
})

test('all three permission modes persist through both handover directions and remain session-local', async () => {
  for (const permissionMode of ['safe', 'ask', 'allow-all'] as const) {
    const f = await fixture()
    try {
      f.manager.setSessionPermissionMode(f.source.id, permissionMode)
      const pro = (await f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'mode-pro', targetMode: 'PRO' })).records[0]!
      expect(pro.creationConfig?.permissionMode).toBe(permissionMode)
      expect(loadSession(f.root, pro.targetSessionId!)?.permissionMode).toBe(permissionMode)
      expect(f.manager.getSessionPermissionModeState(pro.targetSessionId!)?.permissionMode).toBe(permissionMode)
      f.manager.setSessionPermissionMode(f.source.id, permissionMode === 'safe' ? 'allow-all' : 'safe')
      const norm = (await f.manager.handoverSession(pro.targetSessionId!, { type: 'create', handoverId: 'mode-norm', targetMode: 'NORM' })).records[0]!
      expect(norm.creationConfig?.permissionMode).toBe(permissionMode)
      expect(loadSession(f.root, norm.targetSessionId!)?.permissionMode).toBe(permissionMode)
      expect(f.manager.getSessionPermissionModeState(norm.targetSessionId!)?.permissionMode).toBe(permissionMode)
    } finally { await f.cleanup() }
  }
})

test('legacy prepared handovers keep their safe default and invalid permission configurations are rejected', async () => {
  const f = await fixture()
  try {
    const create = f.manager.createSession.bind(f.manager)
    f.manager.createSession = async () => { throw new Error('crash-before-target') }
    await expect(f.manager.handoverSession(f.source.id, { type: 'create', handoverId: 'legacy', targetMode: 'PRO' })).rejects.toThrow('crash-before-target')
    const record = f.store.read('legacy')!
    const path = join(f.store.directory('legacy'), 'record.json')
    for (const permissionMode of ['execute', 'invalid', 2, null]) {
      writeFileSync(path, JSON.stringify({ ...record, creationConfig: { ...record.creationConfig, permissionMode } }))
      expect(() => f.store.read('legacy')).toThrow('creation configuration')
    }
    const { permissionMode: _, ...creationConfig } = record.creationConfig!
    writeFileSync(path, JSON.stringify({ ...record, creationConfig }))
    f.manager.createSession = create
    const recovered = (await f.manager.handoverSession(f.source.id, { type: 'get', handoverId: 'legacy' })).records[0]!
    expect(loadSession(f.root, recovered.targetSessionId!)?.permissionMode).toBe('safe')
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
    const background = f.internal.handoverInput(target)
    const outcomes = JSON.parse(background.split('\n').find((line: string) => line.startsWith('Operation outcomes'))!.split('): ')[1]!)
    expect(outcomes.find((action: { ref: string }) => action.ref === `${f.source.id}:publish`).outcome).toBe('not-performed')
    expect(background).toContain('Unreviewed unknown operations: 0')
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'Write', { file_path: f.file })).not.toThrow()
    expect(target.permissionMode).toBe('allow-all')
    expect(() => f.internal.assertHandoverOperationAllowed(target, 'external_send', { target: 'example', value: 'sent' })).toThrow('already completed')
    const worker = createManagedSession({ id: 'handover-worker', workMode: 'PRO', parentSessionId: target.id, executionRootSessionId: target.id }, f.workspace, { messagesLoaded: true })
    expect(() => f.internal.assertHandoverOperationAllowed(worker, 'external_send', { target: 'example', value: 'sent' })).toThrow('already completed')
    const next = (await f.manager.handoverSession(target.id, { type: 'create', handoverId: 'reviewed-chain', targetMode: 'NORM' })).records[0]!
    expect(next.snapshot!.actions.find(action => action.ref === `${f.source.id}:publish`)!.outcome).toBe('not-performed')
    const nextTarget = f.internal.sessions.get(next.targetSessionId!)
    expect(() => f.internal.assertHandoverOperationAllowed(nextTarget, 'Write', { file_path: '/new.txt', content: 'new' })).not.toThrow()
    expect(() => f.internal.assertHandoverOperationAllowed(nextTarget, 'external_send', { target: 'example', value: 'sent' })).toThrow('already completed')
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
    expect(reserved.creationConfig?.permissionMode).toBe('allow-all')
    expect(existsSync(getSessionPath(f.root, reserved.targetSessionId!))).toBe(false)
    f.manager.setSessionPermissionMode(f.source.id, 'safe')
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
    expect(target.permissionMode).toBe('allow-all')
    expect(loadSession(f.root, reserved.targetSessionId!)?.permissionMode).toBe('allow-all')
    restarted.setSessionPermissionMode(target.id, 'ask')
    await restarted.handoverSession(f.source.id, { type: 'get', handoverId: 'reservation' })
    expect(target.permissionMode).toBe('ask')
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
  const url = 'https://1.1.1.1/selection-handover-test'
  let content = 'original web content', status = 200
  const fetcher = spyOn(globalThis,'fetch').mockImplementation(Object.assign(async () => new Response(content, { status, headers: { 'Content-Type': 'text/plain' } }), { preconnect: () => {} }))
  try {
    f.source.messages.push({ id: 'web', role: 'tool', toolUseId: 'fetch', toolName: 'WebFetch', toolInput: { url }, toolStatus: 'completed', content: 'read page', toolResult: `Content from ${url}:\n\noriginal web content`, timestamp: 4 })
    const record = (await f.manager.handoverSession(f.source.id,{type:'create',handoverId:'web-source',targetMode:'PRO'})).records[0]!
    expect(fetcher).not.toHaveBeenCalled()
    const web = record.snapshot!.files.find(file => file.sourceUrl === url)!
    expect(web).toBeDefined()
    const check = async () => (await f.manager.handoverSession(record.targetSessionId!,{type:'get',handoverId:'web-source',checkSources:true})).changes?.find(change=>change.ref===web.ref)?.state
    expect(await check()).toBe('unchanged')
    content = 'changed web content'
    expect(await check()).toBe('changed')
    status = 403
    expect(await check()).toBe('unavailable')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(readFileSync(join(getSessionPath(f.root,record.targetSessionId!),'data','handover','web-source',web.snapshotPath),'utf8')).toContain('original web content')
    expect(f.store.read('web-source')?.snapshot).toEqual(record.snapshot)
  } finally { fetcher.mockRestore(); await f.cleanup() }
})

test('frozen web-source checks ignore cache paths but detect changes beyond the displayed excerpt', async () => {
  const f = await fixture()
  const url = 'https://1.1.1.1/selection-handover-test'
  let content = 'original web content\n' + 'x'.repeat(50_000)
  const fetcher = spyOn(globalThis,'fetch').mockImplementation(Object.assign(async () => new Response(content, { headers: { 'Content-Type': 'text/plain' } }), { preconnect: () => {} }))
  try {
    const { createWebFetchTool } = await import('../../../pi-agent-server/src/tools/web-fetch')
    const result = await createWebFetchTool(() => getSessionPath(f.root, f.source.id)).execute('fetch', { url }, undefined, undefined, undefined as never)
    const original = result.content.filter(part => part.type === 'text').map(part => part.text).join('')
    expect(original).toContain('Content truncated')
    f.source.messages.push({ id: 'web', role: 'tool', toolUseId: 'fetch', toolName: 'WebFetch', toolInput: { url }, toolStatus: 'completed', content: original, timestamp: 4 })
    const record = (await f.manager.handoverSession(f.source.id,{type:'create',handoverId:'web-source',targetMode:'PRO'})).records[0]!
    const web = record.snapshot!.files.find(file => file.sourceUrl === url)!
    const check = async () => (await f.manager.handoverSession(record.targetSessionId!,{type:'get',handoverId:'web-source',checkSources:true})).changes?.find(change=>change.ref===web.ref)?.state
    expect(await check()).toBe('unchanged')
    content += 'changed after the displayed excerpt'
    expect(await check()).toBe('changed')
    expect(f.store.snapshotBytes(record.handoverId, web.snapshotPath, web.hash).toString('utf8')).toBe(original)
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
