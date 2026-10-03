#!/usr/bin/env bun
/** Real-model F0 through the existing SessionManager and TaskRunner.
 * Uses a configured workspace/connection; no credential copies or new runtime.
 * All agent sessions are hidden and safe (read-only). Durable results stay in
 * the workspace so a new process can inspect the same run without executing it.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { parseTaskSpec, saveTaskSpec, loadTaskResults, readRunLog, runDir } from '@craft-agent/shared/tasks'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { TaskRunner } from '@craft-agent/server-core/tasks'

const repo = resolve(import.meta.dir, '..')
const fixture = join(repo, 'scripts/fixtures/selection-3.0/costs.txt')
const workspace = process.env.F0_WORKSPACE_ID
  ? getWorkspaces().find(w => w.id === process.env.F0_WORKSPACE_ID) : getWorkspaces()[0]
assert(workspace, 'F0 requires a configured Selection workspace')
setBundledAssetsRoot(join(repo, 'apps/electron'))
setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager()
manager.setEventSink(() => {})
// Do not initialize background automation/watchers for a developer acceptance
// run. The sessions below use the real backend/auth and normal message pipeline.
const runner = new TaskRunner({ host: manager, workspaceId: workspace.id, workspaceRoot: workspace.rootPath })
manager.setTaskRunnerLookup(id => {
  assert.equal(id, workspace.id)
  return runner
})

try {
  if (process.argv[2] === '--inspect') {
    const [slug, runId] = process.argv.slice(3)
    assert(slug && runId, 'Usage: bun scripts/selection-3.0-f0.ts --inspect <slug> <runId>')
    const before = readFileSync(join(runDir(workspace.rootPath, slug, runId), 'run-log.jsonl'), 'utf8')
    const result = loadTaskResults(workspace.rootPath, slug, runId)
    const history = runner.getRunHistory(slug, result.orchestratorSessionId!)
    assert.equal(history.find(run => run.runId === runId)?.status, result.runStatus)
    assert.equal(readFileSync(join(runDir(workspace.rootPath, slug, runId), 'run-log.jsonl'), 'utf8'), before)
    console.log(JSON.stringify({ workspaceId: workspace.id, result, history }, null, 2))
  } else {
    const connectionSlug = process.env.F0_LLM_CONNECTION ?? getDefaultLlmConnection()
    const connection = getLlmConnections().find(c => c.slug === connectionSlug)
    assert(connection?.defaultModel, 'F0 requires a configured LLM connection with a default model')
    await manager.reinitializeAuth()
    const slug = `f0-${Date.now()}`
    const root = await manager.createSession(workspace.id, {
      name: 'Selection 3.0 F0', taskSlug: slug, hidden: true,
      permissionMode: 'safe', workingDirectory: join(repo, 'scripts/fixtures/selection-3.0'),
      model: connection.defaultModel, llmConnection: connection.slug,
    })
    const parsed = parseTaskSpec({
      schema_version: 3, id: slug, title: 'Selection 3.0 F0', runner: 'conduct',
      goal: '读取固定资料并提交 A 的两年成本与尚未核实的问题',
      defaults: { permissionMode: 'safe' },
      nodes: [{ id: 'a',
        prompt: `Read the local file ${JSON.stringify(fixture)} with a file tool. Use submit_task_output to submit a concise report and values {total_cost: the two-year cost of A in yuan as a number, unresolved: whether unverified questions remain as a boolean}. Do not delegate. Do not create or change files. Explain which questions remain unverified.`,
        outputs: [{ name: 'total_cost', kind: 'param', type: 'number', required: true },
          { name: 'unresolved', kind: 'param', type: 'boolean', required: true }],
      }],
    })
    assert(parsed.success, 'Invalid F0 task fixture')
    saveTaskSpec(workspace.rootPath, parsed.data)
    const start = runner.run(slug, { orchestratorSessionId: root.id, verifyOnComplete: false })
    const terminal = await runner.waitUntilSettled(slug, start.runId)
    const result = loadTaskResults(workspace.rootPath, slug, start.runId)
    assert.equal(terminal.status, 'completed', JSON.stringify(result))
    assert.equal(result.nodes[0]?.outputs?.total_cost, 1000000)
    assert.equal(result.nodes[0]?.outputs?.unresolved, true)
    assert(result.nodes[0]?.output)
    assert.equal(result.orchestratorSessionId, root.id)
    assert.equal(result.nodes[0]?.revision, 0)
    const before = JSON.stringify(readRunLog(workspace.rootPath, slug, start.runId))
    const restored = new TaskRunner({ host: manager, workspaceId: workspace.id, workspaceRoot: workspace.rootPath })
    const reloaded = restored.getLatestRun(slug)
    assert(reloaded)
    assert.deepEqual([reloaded.workspaceId, reloaded.taskId, reloaded.runId, reloaded.revision,
      reloaded.orchestratorSessionId, reloaded.status],
    [terminal.workspaceId, terminal.taskId, terminal.runId, terminal.revision, root.id, 'completed'])
    assert.deepEqual(reloaded.nodes.map(n => [n.id, n.state, n.sessionId, n.attempt, n.attempts]),
      terminal.nodes.map(n => [n.id, n.state, n.sessionId, n.attempt, n.attempts]))
    assert.deepEqual(loadTaskResults(workspace.rootPath, slug, start.runId), result)
    assert.equal(JSON.stringify(readRunLog(workspace.rootPath, slug, start.runId)), before)
    assert.equal(readRunLog(workspace.rootPath, slug, start.runId).filter(e => e.kind === 'node-spawned').length, 1)
    const ordinary = await manager.createSession(workspace.id, {
      name: 'F0 ordinary conversation regression', hidden: true, permissionMode: 'safe',
      workingDirectory: join(repo, 'scripts/fixtures/selection-3.0'),
      model: connection.defaultModel, llmConnection: connection.slug,
    })
    await manager.sendMessage(ordinary.id, `Read ${JSON.stringify(fixture)} with a file tool. Reply with A's two-year cost as an integer in yuan, and the questions that remain unverified. Do not delegate or modify files.`)
    assert(manager.getSessionFinalText(ordinary.id)?.replace(/[,，\s]/g, '').includes('1000000'))
    assert(manager.sessionUsedTools(ordinary.id))
    // Exercise the existing legacy conduct path as well as the new v3 fixture.
    const legacySlug = `${slug}-legacy`
    const legacy = parseTaskSpec({ id: legacySlug, title: 'F0 legacy conduct regression', goal: 'Read and summarize',
      defaults: { permissionMode: 'safe' }, nodes: [
        { id: 'read', prompt: `Read ${JSON.stringify(fixture)} with a file tool. Return A's two-year cost in yuan as digits only. Do not change files.` },
        { id: 'summarize', depends_on: ['read'], inputs: { cost: '${nodes.read.output}' },
          prompt: 'Dependency cost in yuan: ${inputs.cost}. State this cost in yuan as digits only. Do not use tools or change files.' },
      ] })
    assert(legacy.success)
    saveTaskSpec(workspace.rootPath, legacy.data)
    const legacyRoot = await manager.createSession(workspace.id, {
      name: 'F0 legacy conduct regression', taskSlug: legacySlug, hidden: true, permissionMode: 'safe',
      model: connection.defaultModel, llmConnection: connection.slug,
    })
    const legacyRun = runner.run(legacySlug, { orchestratorSessionId: legacyRoot.id, verifyOnComplete: false })
    const legacyTerminal = await runner.waitUntilSettled(legacySlug, legacyRun.runId)
    assert.equal(legacyTerminal.status, 'completed')
    const legacyResult = loadTaskResults(workspace.rootPath, legacySlug, legacyRun.runId)
    assert(legacyResult.nodes.find(n => n.id === 'summarize')?.output?.replace(/[,，\s]/g, '').includes('1000000'))
    const record = { fixtureHash: createHash('sha256').update(readFileSync(fixture)).digest('hex'),
      workspaceId: workspace.id, model: connection.defaultModel, connection: connection.slug,
      runDirectory: runDir(workspace.rootPath, slug, start.runId), terminal, result,
      regressions: { ordinarySessionId: ordinary.id, ordinaryOutput: manager.getSessionFinalText(ordinary.id), legacyResult },
      reload: 'same run, output, revision and attempt; no additional execution',
    }
    const recordPath = process.env.F0_RECORD_PATH ?? `/tmp/selection-${slug}.json`
    writeFileSync(recordPath, JSON.stringify(record, null, 2))
    console.log(JSON.stringify({ recordPath, ...record }, null, 2))
  }
} finally {
  await manager.flushAllSessions()
  manager.cleanup()
}
