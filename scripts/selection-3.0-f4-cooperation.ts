#!/usr/bin/env bun
/** F4-c: production actor turns and owned Swarm execution; only transport timing is controlled. */
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
const fixture = join(repo, 'scripts/fixtures/selection-3.0/costs.txt'), nonce = randomUUID()
setBundledAssetsRoot(join(repo, 'apps/electron')); setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager(); manager.setEventSink(() => {})
const internal = manager as any, originalSwarm = getSwarmAgentsEnabled()
const slug = `f4-c-${Date.now()}`
let runner: TaskRunner, rootId = '', runId = '', finished = false, registered = false, primaryWaitObserved = false
let releaseB!: () => void, releaseWorker!: () => void
const holdB = new Promise<void>(resolve => { releaseB = resolve }), holdWorker = new Promise<void>(resolve => { releaseWorker = resolve })
let rejectBlocked!: (error: Error) => void
const blocked = new Promise<never>((_resolve, reject) => { rejectBlocked = reject }); void blocked.catch(() => {})
const originalSend = manager.sendMessage.bind(manager)
manager.sendMessage = async (id, message, ...args) => {
  const managed = internal.sessions.get(id)
  if (managed?.taskWorkerId) await holdWorker
  return originalSend(id, message, ...args)
}
const host = new Proxy(manager, { get(target, property) {
  if (property === 'sendMessage') return async (id: string, message: string) => {
    const nodeId = internal.sessions.get(id)?.taskNodeId
    if (nodeId === 'b') await holdB
    if (nodeId === 'a2' && !registered) {
      registered = true
      const root = internal.sessions.get(rootId)
      // The QA driver issues the same trusted qualification seam as a real
      // coordinator turn. It does not bypass capability, permission or binding checks.
      internal.issueSpawnQualificationCredentials(root, 'automatic')
      await internal.spawnSessionFromTool(root, { taskBinding: { runId, nodeId: 'a2' }, role: 'reviewer', lifecycle: 'managed', spawnReason: 'automatic', mode: 'background',
        name: 'F4-c independent source reviewer', prompt: `Read ${JSON.stringify(fixture)} with a file tool. Independently check the two-year A cost and B source limits. Give a short final result with cost and limitations. Do not call submit_task_output, delegate, write or run external actions.`,
        qualification: { tracks: [
          { name: 'actor analysis', input: 'A1 cost result', expectedOutput: 'A2 contextual report', evidence: 'prior conversation cost', toolKinds: ['Read'] },
          { name: 'source review', input: fixture, expectedOutput: 'independent cost/source check', evidence: 'original text', toolKinds: ['Read'] } ],
          parallelBenefit: 'independent review overlaps the actor continuation', finalAggregation: 'canonical node waits for independent review and final run output records both facts' } })
    }
    return target.sendMessage(id, message)
  }
  const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value
} }) as ConductorSessionHost
try {
  setSwarmAgentsEnabled(true); await manager.reinitializeAuth()
  const parsed = parseTaskSpec({ schema_version: 3, id: slug, title: 'Selection 3.0 F4-c', goal: 'same actor continuity with distinct node outputs and owned independent review', runner: 'conduct',
    execution: { verification: { required: false } }, constraints: ['Read-only fixed fixtures. No delegation by task workers. Do not invent missing sources.'],
    defaults: { model: connection.defaultModel, llmConnection: connection.slug, permissionMode: 'safe' },
    nodes: [
      { id: 'a1', actor: { id: 'analyst', persona: 'careful cost analyst' }, prompt: `Keep this private context marker for your next task: ${nonce}. Read ${JSON.stringify(fixture)} with a file tool. Submit only A's two-year cost via submit_task_output values {cost:number} and short text, without putting the private marker in this task output.`, outputs: [{ name: 'cost', kind: 'param', type: 'number', required: true }] },
      { id: 'a2', actor: { id: 'analyst', persona: 'careful cost analyst' }, prompt: 'Recall the private context marker from your preceding task in this conversation, and A cost. Submit values {marker:string,cost:number} using submit_task_output. Explain the remembered context briefly.', outputs: [{ name: 'marker', kind: 'param', type: 'string', required: true }, { name: 'cost', kind: 'param', type: 'number', required: true }] },
      { id: 'b', actor: { id: 'independent' }, prompt: `Read ${JSON.stringify(fixture)} and use submit_task_output values {verified:boolean} to state whether B cost basis is verified.`, outputs: [{ name: 'verified', kind: 'param', type: 'boolean', required: true }] },
    ] }); assert(parsed.success, JSON.stringify(parsed)); saveTaskSpec(workspace.rootPath, parsed.data)
  runner = new TaskRunner({ host, workspaceId: workspace.id, workspaceRoot: workspace.rootPath, onRunChanged(snapshot) {
    if (snapshot.status === 'paused' || snapshot.status === 'failed') rejectBlocked(new Error(`F4-c blocked: ${snapshot.status}: ${snapshot.blockers?.join(', ')}`))
  } }); manager.setTaskRunnerLookup(() => runner)
  const root = await manager.createSession(workspace.id, { name: 'Selection 3.0 F4-c', taskSlug: slug, hidden: true, workMode: 'PRO', swarmEnabled: true,
    permissionMode: 'safe', thinkingLevel: 'low', workingDirectory: join(repo, 'scripts/fixtures/selection-3.0'), model: connection.defaultModel, llmConnection: connection.slug }); rootId = root.id
  const start = runner.run(slug, { orchestratorSessionId: rootId, verifyOnComplete: false }); runId = start.runId
  manager.onSessionComplete(event => {
    const managed = internal.sessions.get(event.sessionId)
    if (managed?.taskNodeId === 'a2' && !managed.taskWorkerId && event.reason === 'complete') {
      const snapshot = runner.getRunState(slug, runId)!
      primaryWaitObserved = snapshot.nodes.find(node => node.id === 'a2')!.state === 'running' && snapshot.workers?.[0]?.state === 'running'
      releaseWorker(); releaseB()
    }
  })
  const terminal = await Promise.race([runner.waitUntilSettled(slug, runId), blocked])
  const results = loadTaskResults(workspace.rootPath, slug, runId), log = readRunLog(workspace.rootPath, slug, runId)
  const record = { case: 'F4-c', slug, runId, rootSessionId: rootId, workspaceId: workspace.id, model: connection.defaultModel, connection: connection.slug, permissionMode: 'safe',
    timingControl: 'B and owned reviewer real-model sends held until the A2 primary turn completes; all outputs use real model interfaces',
    nonce, primaryWaitObserved, fixtureSha256: createHash('sha256').update(readFileSync(fixture)).digest('hex'), terminal, results, log }
  writeFileSync(process.env.F4_RECORD_PATH ?? '/tmp/selection-version-3.0/454-f4-c-real.json', JSON.stringify(record, null, 2))
  assert.equal(terminal.status, 'completed'); assert(primaryWaitObserved)
  assert.equal(terminal.nodes.find(node => node.id === 'a1')!.sessionId, terminal.nodes.find(node => node.id === 'a2')!.sessionId)
  assert.equal(results.nodes.find(node => node.id === 'a2')!.outputs!.marker, nonce)
  assert.equal(results.nodes.find(node => node.id === 'a1')!.outputs!.cost, 1000000)
  assert.equal(results.nodes.find(node => node.id === 'a2')!.outputs!.cost, 1000000)
  assert.equal(terminal.workers!.length, 1); assert.equal(terminal.workers![0]!.state, 'done'); assert(terminal.workers![0]!.output!.text.includes('1,000,000') || terminal.workers![0]!.output!.text.includes('1000000') || terminal.workers![0]!.output!.text.includes('100 万'))
  const spawned = log.filter(event => event.kind === 'node-spawned'); assert.equal(spawned.length, 3); assert(spawned.some(event => event.nodeId === 'a2' && event.reused))
  finished = true; console.log(JSON.stringify({ case: 'F4-c', slug, runId, rootSessionId: rootId, sameActorSession: true, markerRecovered: true, primaryWaitObserved, worker: terminal.workers![0]!.sessionId, status: terminal.status }))
} catch (error) {
  writeFileSync(process.env.F4_RECORD_PATH ?? '/tmp/selection-version-3.0/454-f4-c-real.json', JSON.stringify({ case: 'F4-c', outcome: 'failed', error: String(error), slug, runId, rootSessionId: rootId, snapshot: runner!?.getRunState(slug, runId), log: runId ? readRunLog(workspace.rootPath, slug, runId) : [] }, null, 2)); throw error
} finally {
  releaseB(); releaseWorker()
  if (!finished && runner! && runId) await runner.stop(slug, runId).catch(() => {})
  if (rootId) await manager.cancelProcessing(rootId, true).catch(() => {})
  await manager.flushAllSessions(); manager.cleanup(); setSwarmAgentsEnabled(originalSwarm)
}
