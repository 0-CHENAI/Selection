#!/usr/bin/env bun
/** Read-only acceptance export. Never create a SessionManager or acquire a running task. */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSession, listSessions } from '@craft-agent/shared/sessions'
import { loadTaskResults, readRunLog, readRunState, readSpecRevision, planValueKey } from '@craft-agent/shared/tasks'
import { HandoverStore } from '../packages/server-core/src/reliability/handover-store'

const fixture = JSON.parse(readFileSync(process.env.DESKTOP_RECORD ?? '/tmp/selection-version-3.0/457-desktop-fixture.json', 'utf8'))
const root = fixture.workspace.rootPath
const slug = process.env.F7_SLUG ?? 'f7-desktop-research'
const runId = process.env.F7_RUN ?? 'run-1791087470605'
const results = loadTaskResults(root, slug, runId)
const log = readRunLog(root, slug, runId)
const state = readRunState(root, slug, runId)
const first = readSpecRevision(root, slug, runId, 0)!
const current = readSpecRevision(root, slug, runId, results.revision!)!
const rootId = results.orchestratorSessionId!
const store = new HandoverStore(join(root, 'handovers'), fixture.workspace.id)
const handovers = store.list(rootId)
const delivered = handovers.find(record => record.sourceSessionId === rootId && record.targetMode === 'NORM' && record.status === 'applied' && !record.snapshot?.actions.some(action => action.outcome === 'unknown'))
const ids = [...new Set([fixture.f7, rootId, ...log.flatMap(event => event.kind === 'node-spawned' ? [event.sessionId] : []), ...(delivered?.targetSessionId ? [delivered.targetSessionId] : [])])]
const sessions = ids.map(id => {
  const session = loadSession(root, id)!
  const sdkDir = join(root, 'sessions', id, '.pi-sessions')
  const entries = existsSync(sdkDir) ? readdirSync(sdkDir).filter(file => file.endsWith('.jsonl')).flatMap(file => readFileSync(join(sdkDir, file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))) : []
  const messages = [...new Map(entries.filter(entry => entry.type === 'message' && entry.message?.role === 'assistant').map(entry => [entry.id, entry])).values()]
  const usage = { modelCalls: messages.length, missingUsage: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, costUsd: 0, costPriced: false }
  for (const entry of messages) {
    const used = entry.message.usage
    if (!used) { usage.missingUsage += 1; continue }
    for (const key of ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'] as const) usage[key] += used[key] ?? 0
    usage.costUsd += used.cost?.total ?? 0
  }
  const tools = session.messages.filter(message => message.type === 'tool').map(message => ({
    name: message.toolName, status: message.toolStatus, isError: message.isError,
    result: message.isError ? message.toolResult ?? message.content : undefined,
  }))
  const reads = entries.flatMap(entry => entry.type === 'message' && entry.message?.role === 'assistant'
    ? entry.message.content.filter((part: any) => part.type === 'toolCall' && ['Read', 'read'].includes(part.name)).map((part: any) => ({ id: part.id, arguments: part.arguments })) : [])
  return { id, workMode: session.workMode, model: session.model, connection: session.llmConnection, permissionMode: session.permissionMode,
    parentSessionId: session.parentSessionId, executionRootSessionId: session.executionRootSessionId, taskSlug: session.taskSlug,
    taskRunId: session.taskRunId, taskNodeId: session.taskNodeId, taskAttempt: session.taskAttempt, taskRevision: session.taskRevision,
    usage, reads, tools, finalText: session.messages.filter(message => message.type === 'assistant').at(-1)?.content }
})
const locks = Object.fromEntries((first.locked_fields ?? []).map(field => [field, planValueKey(first[field]) === planValueKey(current[field])]))
const lockedRiskPreserved = planValueKey(first.nodes.find(node => node.id === 'risk')) === planValueKey(current.nodes.find(node => node.id === 'risk'))
const retrySets = log.flatMap(event => event.kind === 'run-resumed' && event.retryNodeIds ? [event.retryNodeIds] : [])
assert.equal(results.runStatus, 'completed')
assert.equal(results.verdict?.result, 'pass')
assert(Object.values(locks).every(Boolean) && lockedRiskPreserved)
assert.deepEqual(results.research?.report?.claimRefs, [{ id: 'cost', version: 2 }, { id: 'b-basis', version: 1 }])
assert.deepEqual(results.research?.coverage, { covered: 1, limited: 0, uncovered: 1, total: 2 })
assert.deepEqual(results.research?.blockers, [])
assert.equal(results.research?.issues.find(issue => issue.id === 'wrong-cost')?.state, 'resolved')
for (const claim of results.research?.claims ?? []) {
  assert.equal(claim.review?.support, 'supported')
  assert.notEqual(claim.producedBy.sessionId, claim.reviewer?.sessionId)
  assert(sessions.find(session => session.id === claim.reviewer?.sessionId)?.reads.length)
}
assert(delivered?.snapshot && delivered.targetSessionId, 'Complete the final desktop Handover first')
const target = loadSession(root, delivered.targetSessionId)!
assert.equal(target.workMode, 'NORM'); assert.equal(target.permissionMode, 'safe')
assert.equal(target.parentSessionId, undefined); assert.equal(target.taskSlug, undefined)
assert.equal(listSessions(root).filter(session => session.parentSessionId === target.id || session.executionRootSessionId === target.id && session.id !== target.id).length, 0)
const report = JSON.parse(delivered.snapshot.originals.find(original => original.role === 'task-result' && original.id === `${runId}:revision-${results.revision}`)!.text)
assert.deepEqual(report.research.report.claimRefs, results.research?.report?.claimRefs)
const totals = sessions.reduce((sum, session) => {
  for (const key of ['modelCalls', 'missingUsage', 'input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'costUsd'] as const) sum[key] += session.usage[key]
  return sum
}, { modelCalls: 0, missingUsage: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, costUsd: 0, costPriced: false })
const record = { capturedAt: new Date().toISOString(), case: 'F7 actual desktop', codeBase: '0d2e8d665e898007a3b79b7b89b0816ad7e49b49',
  workspace: fixture.workspace, slug, runId, rootId, results, state, log,
  checks: { locks, lockedRiskPreserved, retrySets, sourceHash: createHash('sha256').update(results.research!.sources[0]!.text!).digest('hex'), independentReview: true, noTargetTaskOrWorker: true },
  handovers: handovers.map(record => ({ id: record.handoverId, status: record.status, source: record.sourceSessionId, target: record.targetSessionId, mode: record.targetMode, unknownActions: record.snapshot?.actions.filter(action => action.outcome === 'unknown').map(action => action.tool) })),
  delivered: { id: delivered.handoverId, target: delivered.targetSessionId, snapshot: delivered.snapshot }, sessions, totals }
writeFileSync(process.env.F7_RECORD ?? '/tmp/selection-version-3.0/457-f7-verified.json', JSON.stringify(record, null, 2))
console.log(JSON.stringify({ status: results.runStatus, revision: results.revision, coverage: results.research?.coverage, target: target.id, retrySets, totals }))
