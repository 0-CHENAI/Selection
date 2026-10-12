#!/usr/bin/env bun
/** #453 real safe-mode editor generation and F3 execution, using the production host. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { parseTaskSpec, serializeTaskYaml, saveTaskSpec, materializeDeps, loadTaskResults, readRunLog, type TaskSpec } from '@craft-agent/shared/tasks'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { RPC_CHANNELS, type TaskGenerateResult, type TaskProposalTurn } from '@craft-agent/shared/protocol'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { TaskRunner } from '@craft-agent/server-core/tasks'
import { registerTasksHandlers } from '../packages/server-core/src/handlers/rpc/tasks'
import type { RpcServer } from '../packages/server-core/src/transport'
import type { HandlerDeps } from '../packages/server-core/src/handlers/handler-deps'

const repo = resolve(import.meta.dir, '..'), workspace = getWorkspaces()[0]!
const connection = getLlmConnections().find(c => c.slug === getDefaultLlmConnection())!
assert(workspace && connection?.defaultModel)
const bConnection = getLlmConnections().find(c => c.defaultModel && c.defaultModel !== connection.defaultModel)
assert(bConnection?.defaultModel, 'F3 requires a second configured model for the manual-model scenario')
const fixture = join(repo, 'scripts/fixtures/selection-3.0/costs.txt')
const fixtureSha256 = createHash('sha256').update(readFileSync(fixture)).digest('hex')
setBundledAssetsRoot(join(repo, 'apps/electron')); setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager(); manager.setEventSink(() => {})
const handlers = new Map<string, (...args: any[]) => Promise<any>>()
let settle: ((result: TaskGenerateResult) => void) | undefined
registerTasksHandlers({ handle: (name: string, handler: any) => handlers.set(name, handler), push: (channel: string, _target: unknown, _workspace: string, result: TaskGenerateResult) => { if (channel === RPC_CHANNELS.tasks.GENERATED) settle?.(result) } } as unknown as RpcServer, { sessionManager: manager } as HandlerDeps)
const history: TaskProposalTurn[] = [], generations: TaskGenerateResult[] = []
async function generate(spec: TaskSpec, goal: string, version: number) {
  const completion = new Promise<TaskGenerateResult>(resolve => { settle = resolve })
  await handlers.get(RPC_CHANNELS.tasks.GENERATE)!({}, workspace.id, { goal, currentYaml: serializeTaskYaml(spec), conversation: history, baseDraftVersion: version, model: connection.defaultModel, llmConnection: connection.slug })
  const result = await completion; generations.push(result)
  assert.equal(result.baseDraftVersion, version)
  if (result.validation.valid && result.spec) history.push({ goal, yaml: result.yaml, status: 'applied' })
  return result
}
try {
  await manager.reinitializeAuth()
  const slug = `f3-${Date.now()}`
  const parsed = parseTaskSpec({ schema_version: 3, id: slug, title: 'Selection 3.0 F3', goal: '核对 A 成本和 B 待核对口径', runner: 'conduct',
    constraints: ['只读资料，不执行外部操作'], decisions: ['资料不足时保留未知，禁止编造 B 风险结论'],
    defaults: { model: connection.defaultModel, llmConnection: connection.slug, permissionMode: 'safe' },
    nodes: [
      { id: 'a', prompt: `Read ${JSON.stringify(fixture)} with a file tool. Submit the two-year cost of A in yuan with submit_task_output values {cost: number}, plus a short text including that value. Do not delegate or modify files.`, outputs: [{ name: 'cost', kind: 'param', type: 'number', required: true }] },
      { id: 'b', prompt: `Read ${JSON.stringify(fixture)} with a file tool. Is B's cost basis verified? Submit submit_task_output values {verified: boolean}, plus short prose describing the uncertainty. Do not invent facts, delegate or modify files.`, outputs: [{ name: 'verified', kind: 'param', type: 'boolean', required: true }] },
      { id: 'c', prompt: 'Produce a concise report from both bound inputs: A cost = ${inputs.a_cost}, B verified = ${inputs.b_verified}. Submit submit_task_output values {a_cost: number, b_verified: boolean}, with text explaining B and risk limits. Do not delegate or modify files.', depends_on: ['a'], inputs: { a_cost: '${nodes.a.output.cost}', b_verified: '${nodes.b.output.verified}' }, outputs: [{ name: 'a_cost', kind: 'param', type: 'number', required: true }, { name: 'b_verified', kind: 'param', type: 'boolean', required: true }] },
    ] })
  assert(parsed.success)
  let spec = parsed.data
  const first = await generate(spec, '只将 C 的报告要求加上“用中文说明资料限制”，保留所有节点、依赖、模型配置、输出字段与其它值。不要修改 A 或 B，不要执行。', 1)
  assert(first.validation.valid && first.spec, JSON.stringify(first)); spec = first.spec as TaskSpec
  const b = spec.nodes.find(n => n.id === 'b')!; b.model = bConnection.defaultModel; b.llmConnection = bConnection.slug; b.locked = true; b.timeout = 1234
  spec.locked_fields = ['constraints', 'decisions']; const manualB = structuredClone(b)
  const second = await generate(spec, '只给 C 的报告要求加上一句“明确列出未核实问题”。B 已由用户手工修改并锁定，完整保留 B，以及全部锁定约束和决策，不改其它节点。', 2)
  assert(second.validation.valid && second.spec, JSON.stringify(second)); spec = second.spec as TaskSpec
  assert.deepEqual(spec.nodes.find(n => n.id === 'b'), manualB)
  assert.deepEqual(spec.locked_fields, ['constraints', 'decisions'])
  const lockedAttempt = await generate(spec, '将锁定的 B 模型改成 gpt-6-luna 并删除“未知风险”决策；如果锁定保护阻止此修改，请保持现有定义并说明。', 3)
  if (lockedAttempt.validation.valid && lockedAttempt.spec) {
    const protectedSpec = lockedAttempt.spec as TaskSpec
    assert.deepEqual(protectedSpec.nodes.find(n => n.id === 'b'), manualB)
    assert.deepEqual(protectedSpec.decisions, spec.decisions)
  } else assert(lockedAttempt.error || lockedAttempt.validation.errors.some(error => /Locked/.test(error.message)))
  assert.deepEqual([...materializeDeps(spec).get('c')!], ['a', 'b'])
  saveTaskSpec(workspace.rootPath, spec)
  const runner = new TaskRunner({ host: manager, workspaceId: workspace.id, workspaceRoot: workspace.rootPath })
  manager.setTaskRunnerLookup(id => { assert.equal(id, workspace.id); return runner })
  const root = await manager.createSession(workspace.id, { name: 'Selection 3.0 F3', taskSlug: slug, hidden: true, workMode: 'PRO', permissionMode: 'safe', workingDirectory: join(repo, 'scripts/fixtures/selection-3.0'), model: connection.defaultModel, llmConnection: connection.slug })
  const start = runner.run(slug, { orchestratorSessionId: root.id, verifyOnComplete: false })
  // A later save is for future runs, never a replacement of an active node.
  const later = structuredClone(spec); later.nodes.find(n => n.id === 'b')!.prompt = 'Future-run replacement'; saveTaskSpec(workspace.rootPath, later)
  assert.deepEqual(runner.currentRunSpec(slug, start.runId)!.nodes.find(n => n.id === 'b'), manualB)
  const terminal = await runner.waitUntilSettled(slug, start.runId)
  const results = loadTaskResults(workspace.rootPath, slug, start.runId), log = readRunLog(workspace.rootPath, slug, start.runId)
  assert.equal(terminal.status, 'completed', JSON.stringify(results))
  const report = results.nodes.find(n => n.id === 'c')!
  assert.equal(report.outputs?.a_cost, 1000000); assert.equal(report.outputs?.b_verified, false)
  const cSpawn = log.findIndex(event => event.kind === 'node-spawned' && event.nodeId === 'c')
  for (const id of ['a', 'b']) assert(log.findIndex(event => event.kind === 'node-finished' && event.nodeId === id && event.state === 'done') < cSpawn)
  const record = { workspaceId: workspace.id, slug, runId: start.runId, rootSessionId: root.id, fixtureSha256, model: connection.defaultModel, bModel: manualB.model, connection: connection.slug, bConnection: bConnection.slug, generations, manualLockPreserved: true, frozenRunPreserved: true, effectiveEdges: [['a','c'],['b','c']], results, log }
  writeFileSync('/tmp/selection-version-3.0/453-f3-real.json', JSON.stringify(record, null, 2))
  console.log(JSON.stringify({ slug, runId: start.runId, rootSessionId: root.id, state: terminal.status, output: report.outputs, manualLockPreserved: true, frozenRunPreserved: true }))
} finally { await manager.flushAllSessions(); manager.cleanup() }
