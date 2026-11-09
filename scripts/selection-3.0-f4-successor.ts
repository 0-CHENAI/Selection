#!/usr/bin/env bun
/** F4-b: actual models, a changed input, conservative cross-run reuse and immutable reports. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { parseTaskSpec, saveTaskSpec, loadTaskResults, readRunLog } from '@craft-agent/shared/tasks'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { TaskRunner } from '@craft-agent/server-core/tasks'

const repo = resolve(import.meta.dir, '..'), workspace = getWorkspaces()[0]!
const connection = getLlmConnections().find(c => c.slug === getDefaultLlmConnection())!
assert(workspace && connection?.defaultModel)
const fixture = join(repo, 'scripts/fixtures/selection-3.0/costs.txt'), bytes = readFileSync(fixture)
const sourceHash = createHash('sha256').update(bytes).digest('hex')
setBundledAssetsRoot(join(repo, 'apps/electron')); setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager(); manager.setEventSink(() => {})
const slug = `f4-b-${Date.now()}`, records: unknown[] = []
let runner: TaskRunner, rootId = '', currentRun = '', finished = false
let rejectBlocked!: (error: Error) => void
const blocked = new Promise<never>((_resolve, reject) => { rejectBlocked = reject }); void blocked.catch(() => {})
try {
  await manager.reinitializeAuth()
  const parsed = parseTaskSpec({ schema_version: 3, id: slug, title: 'Selection 3.0 F4-b', goal: '对比 A 的预算情景和 B 的资料口径，保留不同预算版本的报告', runner: 'conduct', execution: { verification: { required: false } },
    params: [{ name: 'budget', type: 'number', default: 1000000 }],
    constraints: ['只读给定资料，不委派、不写文件、不触发外部操作；预算情景与资料事实分别表述。'],
    defaults: { model: connection.defaultModel, llmConnection: connection.slug, permissionMode: 'safe' },
    nodes: [
      { id: 'a', inputs: { budget: '${params.budget}' }, prompt: `Read ${JSON.stringify(fixture)} with a file tool. A source cost is 1000000 yuan; the user-authorized current budget scenario is \${inputs.budget} yuan. Submit the scenario budget as submit_task_output values {cost:number}; clearly distinguish this scenario from source cost.`, outputs: [{ name: 'cost', kind: 'param', type: 'number', required: true }] },
      { id: 'b', cache: 'workspace-pure', prompt: `Tool-free pure inference from this fixed quoted input only: B口径未核验. Source version sha256=${sourceHash}. Do not read files, search, call models, or consult external state. Only submit_task_output values {verified:false} with the limitation in text.`, outputs: [{ name: 'verified', kind: 'param', type: 'boolean', required: true }] },
      { id: 'c', depends_on: ['a'], inputs: { cost: '${nodes.a.output.cost}', verified: '${nodes.b.output.verified}' }, prompt: '中文报告 A 当前预算情景 ${inputs.cost} 元；B 口径已核验=${inputs.verified}。不把情景金额误写成源资料成本。提交 submit_task_output values {cost:number,verified:boolean} 并给出完整短报告。', outputs: [{ name: 'cost', kind: 'param', type: 'number', required: true }, { name: 'verified', kind: 'param', type: 'boolean', required: true }] },
    ] }); assert(parsed.success, JSON.stringify(parsed)); saveTaskSpec(workspace.rootPath, parsed.data)
  runner = new TaskRunner({ host: manager, workspaceId: workspace.id, workspaceRoot: workspace.rootPath, onRunChanged(snapshot) {
    if (snapshot.status === 'paused' || snapshot.status === 'failed') rejectBlocked(new Error(`F4-b blocked: ${snapshot.status}: ${snapshot.blockers?.join(', ')}`))
  } }); manager.setTaskRunnerLookup(() => runner)
  const root = await manager.createSession(workspace.id, { name: 'Selection 3.0 F4-b', taskSlug: slug, hidden: true, workMode: 'PRO', swarmEnabled: false, permissionMode: 'safe', thinkingLevel: 'low', workingDirectory: join(repo,'scripts/fixtures/selection-3.0'), model: connection.defaultModel, llmConnection: connection.slug }); rootId = root.id
  const first = runner.run(slug, { orchestratorSessionId: rootId, verifyOnComplete: false }); currentRun = first.runId
  await Promise.race([runner.waitUntilSettled(slug, currentRun), blocked]); await manager.flushAllSessions(); await new Promise<void>(resolve => setImmediate(resolve))
  const original = loadTaskResults(workspace.rootPath,slug,currentRun)
  records.push({ snapshot: runner.getRunState(slug,currentRun), results: original, log: readRunLog(workspace.rootPath,slug,currentRun) })
  const next = runner.run(slug, { orchestratorSessionId: rootId, verifyOnComplete: false, params: { budget: 1100000 }, resumedFrom: currentRun }); currentRun = next.runId
  const terminal = await Promise.race([runner.waitUntilSettled(slug,currentRun), blocked])
  const updated = loadTaskResults(workspace.rootPath,slug,currentRun), old = loadTaskResults(workspace.rootPath,slug,first.runId), log = readRunLog(workspace.rootPath,slug,currentRun)
  records.push({ snapshot: terminal, results: updated, log })
  writeFileSync(process.env.F4_RECORD_PATH ?? '/tmp/selection-version-3.0/454-f4-b-real.json', JSON.stringify({ case: 'F4-b', slug, rootSessionId: rootId, model: connection.defaultModel, connection: connection.slug, permissionMode: 'safe', fixtureSha256: sourceHash, changedInput: { budget: [1000000,1100000] }, records, oldAfterSuccessor: old },null,2))
  assert.equal(terminal.status,'completed'); assert.equal(terminal.resumedFrom,first.runId); assert.equal(old.supersededBy,currentRun)
  assert.deepEqual(old.nodes,original.nodes)
  assert.equal(original.nodes.find(node => node.id === 'c')!.outputs!.cost,1000000)
  assert.equal(updated.nodes.find(node => node.id === 'c')!.outputs!.cost,1100000)
  assert.equal(terminal.nodes.find(node => node.id === 'b')!.cacheStatus,'hit')
  assert.equal(log.filter(event => event.kind === 'node-spawned' && event.nodeId === 'b').length,0)
  assert(log.some(event => event.kind === 'node-spawned' && event.nodeId === 'a')); assert(log.some(event => event.kind === 'node-spawned' && event.nodeId === 'c'))
  finished = true; console.log(JSON.stringify({ case:'F4-b',slug,rootSessionId:rootId,resumedFrom:first.runId,supersededBy:currentRun,independentB:'cache-hit',oldReportPreserved:true,status:terminal.status }))
} catch (error) {
  writeFileSync(process.env.F4_RECORD_PATH ?? '/tmp/selection-version-3.0/454-f4-b-real.json',JSON.stringify({ case:'F4-b',outcome:'failed',error:String(error),slug,rootSessionId:rootId,currentRun,records,snapshot:runner!?.getRunState(slug,currentRun),log:currentRun?readRunLog(workspace.rootPath,slug,currentRun):[] },null,2)); throw error
} finally {
  if (!finished && runner! && currentRun) await runner.stop(slug,currentRun).catch(() => {})
  if (rootId) await manager.cancelProcessing(rootId,true).catch(() => {})
  await manager.flushAllSessions(); manager.cleanup()
}
