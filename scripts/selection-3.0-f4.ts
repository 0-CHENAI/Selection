#!/usr/bin/env bun
/** #454 incremental acceptance: real planner/worker models, production SessionManager and durable facts. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { parseTaskSpec, saveTaskSpec, loadTaskResults, readRunLog } from '@craft-agent/shared/tasks'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { TaskRunner, type ConductorSessionHost } from '@craft-agent/server-core/tasks'
import { getSwarmAgentsEnabled, setSwarmAgentsEnabled } from '../packages/shared/src/config/storage'

const repo = resolve(import.meta.dir, '..'), workspace = getWorkspaces()[0]!
const connection = getLlmConnections().find(c => c.slug === getDefaultLlmConnection())!
assert(workspace && connection?.defaultModel)
const fixture = join(repo, 'scripts/fixtures/selection-3.0/costs.txt')
process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1'
setBundledAssetsRoot(join(repo, 'apps/electron')); setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager(); manager.setEventSink(() => {})
const originalSwarmSetting = getSwarmAgentsEnabled()
const nodeBySession = new Map<string, string>()
let releaseB!: () => void, releasedB = false
let runner: TaskRunner | undefined
let rejectBlocked!: (error: Error) => void
const blocked = new Promise<never>((_resolve, reject) => { rejectBlocked = reject })
void blocked.catch(() => {})
const holdB = new Promise<void>(resolve => { releaseB = resolve })
// Fixed transport timing makes the required A-before-B case reproducible. Every result and decision is model-produced.
const host = new Proxy(manager, { get(target, property) {
  if (property === 'createSession') return async (ws: string, options: Parameters<SessionManager['createSession']>[1]) => {
    const session = await target.createSession(ws, options)
    if (options?.taskNodeId) nodeBySession.set(session.id, options.taskNodeId)
    return session
  }
  if (property === 'sendMessage') return async (id: string, message: string) => {
    if (nodeBySession.get(id) === 'b') {
      await holdB
      if (runner?.getRunState(slug, runId)?.nodes.find(node => node.id === 'b')?.state !== 'running') return
    }
    return target.sendMessage(id, message)
  }
  const value = Reflect.get(target, property)
  return typeof value === 'function' ? value.bind(target) : value
} }) as ConductorSessionHost
let slug = '', runId = '', rootId = '', finished = false
try {
  setSwarmAgentsEnabled(true)
  await manager.reinitializeAuth()
  slug = `f4-a-${Date.now()}`
  const parsed = parseTaskSpec({ schema_version: 3, id: slug, title: 'Selection 3.0 F4-a', goal: '核对 A 成本、B 口径及税口径缺口后交付中文报告', runner: 'orchestrate',
    acceptance_criteria: '报告必须包含 A 两年成本 1000000 元，B 口径未核验、税口径未核验，不编造税额或风险，并引用 A/B/D 输入。',
    constraints: ['只读固定资料，不委派额外 Swarm、不修改文件、不执行外部操作；仅计划指定的 A/B/C/D 工作。'],
    decisions: [
      'first-schedule 时只提交 continue，先并行执行 A、B。收到 A 的结果而 D 尚不存在时，提交一次 patch：添加 id=d 的 session 任务只读同一资料核对税口径，输出 required boolean tax_verified；更新 pending C 使 depends_on 包含 a,b,d，inputs 增加 tax_verified=${nodes.d.output.tax_verified}，prompt 使用 ${inputs.tax_verified}。其它节点、原输入输出、权限及目标保持原样。',
      `D 必须 Read ${JSON.stringify(fixture)}，无法证实税口径时用 submit_task_output 提交 values {tax_verified:false} 和说明。不得再次添加 D。随后 checkpoint 使用 continue 消费结果；所有计划工作完成才 draining 并最终 submit_task_verdict。`,
    ], locked_fields: ['constraints','decisions','goal','acceptance_criteria'],
    defaults: { model: connection.defaultModel, llmConnection: connection.slug, permissionMode: 'safe' },
    nodes: [
      { id: 'a', prompt: `Read ${JSON.stringify(fixture)} with a file tool. Submit the two-year cost of A in yuan using submit_task_output values {cost:number}, with short text. Do not delegate or write.`, outputs: [{ name: 'cost', kind: 'param', type: 'number', required: true }] },
      { id: 'b', prompt: `Read ${JSON.stringify(fixture)} with a file tool. Is B's basis verified? Use submit_task_output values {verified:boolean} with source limits. Do not invent, delegate or write.`, outputs: [{ name: 'verified', kind: 'param', type: 'boolean', required: true }] },
      { id: 'c', depends_on: ['a'], inputs: { a_cost: '${nodes.a.output.cost}', b_verified: '${nodes.b.output.verified}' },
        prompt: '用中文报告 A cost=${inputs.a_cost}，B verified=${inputs.b_verified}，并说明税与风险资料限制。submit_task_output values {a_cost:number,b_verified:boolean}。禁止编造缺失事实。',
        outputs: [{ name: 'a_cost', kind: 'param', type: 'number', required: true }, { name: 'b_verified', kind: 'param', type: 'boolean', required: true }] },
    ] })
  assert(parsed.success, JSON.stringify(parsed)); saveTaskSpec(workspace.rootPath, parsed.data)
  runner = new TaskRunner({ host, workspaceId: workspace.id, workspaceRoot: workspace.rootPath, onRunChanged(snapshot) {
    if (!releasedB && snapshot.nodes.find(node => node.id === 'd')?.state === 'done') { releasedB = true; releaseB() }
    if (snapshot.status === 'paused' || snapshot.status === 'failed') {
      writeFileSync(process.env.F4_RECORD_PATH ?? '/tmp/selection-version-3.0/454-f4-a-real.json', JSON.stringify({ case: 'F4-a', outcome: 'failed', model: connection.defaultModel, connection: connection.slug, snapshot, log: readRunLog(workspace.rootPath, snapshot.slug, snapshot.runId) }, null, 2))
      rejectBlocked(new Error(`F4-a blocked: ${snapshot.status}: ${snapshot.blockers?.join(', ')}`))
    }
  } })
  manager.setTaskRunnerLookup(() => runner!)
  const root = await manager.createSession(workspace.id, { name: 'Selection 3.0 F4-a', taskSlug: slug, hidden: true, workMode: 'PRO', swarmEnabled: true,
    permissionMode: 'safe', thinkingLevel: 'low', workingDirectory: join(repo, 'scripts/fixtures/selection-3.0'), model: connection.defaultModel, llmConnection: connection.slug })
  rootId = root.id
  const start = runner.run(slug, { orchestratorSessionId: root.id, orchestrateAllowed: true }); runId = start.runId
  const terminal = await Promise.race([runner.waitUntilSettled(slug, start.runId), blocked])
  const log = readRunLog(workspace.rootPath, slug, start.runId), results = loadTaskResults(workspace.rootPath, slug, start.runId)
  const record = { case: 'F4-a', slug, runId, rootSessionId: root.id, workspaceId: workspace.id, model: connection.defaultModel, connection: connection.slug,
    permissionMode: 'safe', timingControl: 'B real-model send held until D settles; planner and every output use production model interfaces',
    fixtureSha256: createHash('sha256').update(readFileSync(fixture)).digest('hex'), terminal, results, log }
  writeFileSync(process.env.F4_RECORD_PATH ?? '/tmp/selection-version-3.0/454-f4-a-real.json', JSON.stringify(record, null, 2))
  assert.equal(terminal.status, 'completed', JSON.stringify(results))
  const index = (kind: string, nodeId: string) => log.findIndex(event => event.kind === kind && 'nodeId' in event && event.nodeId === nodeId)
  assert(index('node-spawned','b') < index('node-finished','a'))
  assert(index('node-finished','a') < index('node-spawned','d'))
  assert(index('node-spawned','d') < index('node-finished','b'))
  assert(index('node-finished','b') < index('node-spawned','c'))
  assert(index('node-finished','d') < index('node-spawned','c'))
  assert.equal(log.filter(event => event.kind === 'node-spawned' && event.nodeId === 'd').length, 1)
  assert.equal(results.nodes.find(node => node.id === 'c')!.outputs!.a_cost, 1000000)
  assert.equal(terminal.planner!.pendingResults.length, 0); assert.equal(terminal.planner!.phase, 'exhausted')
  finished = true
  console.log(JSON.stringify({ case: 'F4-a', slug, runId, rootSessionId: root.id, status: terminal.status, revision: terminal.revision, pendingResults: 0 }))
} finally {
  if (!finished && runner && runId) await runner.stop(slug, runId).catch(() => {})
  releaseB()
  if (rootId) await manager.cancelProcessing(rootId, true).catch(() => {})
  await manager.flushAllSessions(); manager.cleanup()
  setSwarmAgentsEnabled(originalSwarmSetting)
}
