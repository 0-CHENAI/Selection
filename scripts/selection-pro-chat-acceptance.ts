#!/usr/bin/env bun
/** Real-agent chat intake acceptance. No pre-authored plan, manual patch or YAML injection. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection, ensureConfigDir } from '@craft-agent/shared/config'
import { loadTaskResults, readRunLog } from '@craft-agent/shared/tasks'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { TaskRunner } from '@craft-agent/server-core/tasks'
import { setBackendModelRequestLimiter } from '../packages/shared/src/agent/backend/index'
import { LlmConnectionPool } from '../packages/server-core/src/tasks/connection-pool'

const repo = resolve(import.meta.dir, '..')
const repair = process.argv.includes('--repair')
const errata = process.argv.includes('--errata')
const research = process.argv.includes('--research') || errata
const concurrency = process.argv.includes('--concurrency')
const requestMetrics = { acquired: 0, released: 0, active: 0, peak: 0, owners: new Set<string>() }
if (concurrency) {
  const pool = new LlmConnectionPool()
  setBackendModelRequestLimiter(async (quota, owner, signal) => {
    const lease = await pool.acquireRequest(quota, owner, signal)
    requestMetrics.acquired++; requestMetrics.active++; requestMetrics.owners.add(owner)
    requestMetrics.peak = Math.max(requestMetrics.peak, requestMetrics.active)
    console.log(`Model request acquired: ${requestMetrics.acquired}; active: ${requestMetrics.active}`)
    let released = false
    return { release(feedback) {
      if (released) return
      released = true; requestMetrics.released++; requestMetrics.active--
      lease.release(feedback)
    } }
  })
}
const workspace = getWorkspaces()[0]
const connection = getLlmConnections().find(item => item.slug === getDefaultLlmConnection())
assert(workspace && connection?.defaultModel, 'A configured workspace and model are required')
assert.equal(connection.defaultModel, 'gpt-6-luna', 'This acceptance uses the user-requested GPT-6-luna connection')
setBundledAssetsRoot(join(repo, 'apps/electron'))
ensureConfigDir()
setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager()
manager.setEventSink(event => {
  if (event.type === 'error') console.error(JSON.stringify(event))
})
const runner = new TaskRunner({ host: manager, workspaceId: workspace.id, workspaceRoot: workspace.rootPath })
manager.setTaskRunnerLookup(id => id === workspace.id ? runner : null)
try {
  await manager.reinitializeAuth()
  const root = await manager.createSession(workspace.id, { workMode: 'PRO', hidden: true, permissionMode: 'safe',
    model: connection.defaultModel, llmConnection: connection.slug, name: 'PRO 聊天规划验收',
    workingDirectory: join(repo, 'scripts/fixtures/selection-3.0') })
  console.log(`Acceptance root: ${root.id}`)
  const startedAt = Date.now()
  const goal = `请建立并执行计划，对本地成本资料 ${JSON.stringify(join(repo, 'scripts/fixtures/selection-3.0/costs.txt'))} 完成读取、独立核验、报告三个步骤。先给我简要说明计划，随后在当前只读授权内自行推进，无需再次询问是否执行。报告必须区分A的可确认两年成本、B尚未核实的口径及风险缺口，不得捏造事实，不得写文件或改变权限。请使用现有规范计划和真实工具完成，不要只回复规划建议。`
  const researchGoal = `${goal} 请使用内置深度研究能力，提供可追溯的结论版本、原文证据与独立来源审查记录，并在来源包中保留实际查阅范围。成本和风险分别判断覆盖与限制，研究完成不能只看执行完成。`
  await manager.sendMessage(root.id, concurrency ? `${goal} 请把金额与口径分析、风险资料覆盖分析作为两个独立任务并行执行（max_parallel 至少为 2），随后由独立审查和报告节点汇合各自的真实成果。` : errata ? `${researchGoal} 另外，既存草稿 ${JSON.stringify(join(repo, 'scripts/fixtures/selection-3.0/draft.txt'))} 也属于冻结原文。先保留草稿中的 A 金额为待核实结论版本，不能把它当作已确认事实；安排独立来源核验，发现错误后追加针对该精确版本的勘误。在原研究线产生修订版本和新的独立审查，最终报告引用勘误并说明历史结论的失效与修正。不建立替代前提分支，不覆盖任何原文件。` : research ? researchGoal : repair ? `${goal} 另外，本次有既存草稿 ${JSON.stringify(join(repo, 'scripts/fixtures/selection-3.0/draft.txt'))}。请先读取并保留该草稿作为初稿，安排独立核验节点检验它；遇到错误后按核验结果返修并再次独立核验，交付纠正后的报告和修正说明。通过现有动态编排持续推进，只读产生文本成果即可。` : goal)
  const session = await manager.getSession(root.id)
  assert(session?.taskSlug, 'The agent did not bind a canonical plan from the chat goal')
  const start = runner.getLatestRun(session.taskSlug)
  assert(start, 'The agent did not start the canonical plan')
  let terminal = runner.getRunState(session.taskSlug, start.runId)!
  const runDeadline = Date.now() + 900_000
  while (!['completed', 'failed', 'stopped', 'paused', 'interrupted', 'waiting-approval'].includes(terminal.status)) {
    assert(Date.now() < runDeadline, `Acceptance timed out in ${terminal.status}`)
    await new Promise(resolve => setTimeout(resolve, 250))
    terminal = runner.getRunState(session.taskSlug, start.runId)!
  }
  // A submitted verdict settles the scheduler before the coordinator's answer has finished.
  const deadline = Date.now() + 600_000
  while ((await manager.getSession(root.id))?.isProcessing) {
    assert(Date.now() < deadline, 'Coordinator did not finish its report')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const result = loadTaskResults(workspace.rootPath, session.taskSlug, start.runId)
  const events = readRunLog(workspace.rootPath, session.taskSlug, start.runId)
  const record = { rootId: root.id, slug: session.taskSlug, runId: start.runId, model: connection.defaultModel,
    permissionMode: session.permissionMode, status: terminal.status, elapsedMs: Date.now() - startedAt,
    manualPlanEdits: 0, result, events: events.length, finalText: manager.getSessionFinalText(root.id),
    requestMetrics: concurrency ? { ...requestMetrics, owners: [...requestMetrics.owners] } : undefined }
  writeFileSync(concurrency ? '/tmp/selection-pro-chat-concurrency-acceptance.json' : errata ? '/tmp/selection-pro-chat-errata-acceptance.json' : research ? '/tmp/selection-pro-chat-research-acceptance.json' : repair ? '/tmp/selection-pro-chat-repair-acceptance.json' : '/tmp/selection-pro-chat-acceptance.json', JSON.stringify(record, null, 2))
  assert.equal(terminal.status, 'completed', JSON.stringify(terminal.blockers))
  assert.equal(terminal.orchestratorSessionId, root.id)
  assert.equal(session.permissionMode, 'safe')
  if (concurrency) {
    assert(requestMetrics.acquired > 0, 'Actual model requests must acquire host-owned slots')
    assert.equal(requestMetrics.active, 0, 'All completed requests must release their slots')
    assert.equal(requestMetrics.acquired, requestMetrics.released)
    assert(requestMetrics.peak >= 2 && requestMetrics.peak <= 4, 'Independent work must overlap within the shared quota')
    assert.equal(requestMetrics.owners.size, 1, 'Coordinator and workers belong to one root quota owner')
  }
  const spawns = events.filter(event => event.kind === 'node-spawned')
  assert(spawns.length >= 2, 'Independent review requires distinct execution contexts')
  assert(new Set(spawns.map(event => event.sessionId)).size >= 2)
  if (!research) assert(events.some(event => event.kind === 'node-verdict' && event.result === 'pass'), 'Independent review must submit a structured pass verdict')
  assert(result?.nodes.length && result.nodes.length >= 2, 'Independent verification needs a separate node')
  assert(record.finalText?.match(/100|1[,.]?000[,.]?000/), 'The final user report must include the verified cost')
  assert(record.finalText?.includes('B') && /未|待|不/.test(record.finalText), 'The report must retain the unresolved B boundary')
  assert(record.finalText?.includes('风险') && /缺口|缺失/.test(record.finalText), 'The report must retain the risk gap')
  if (research) {
    assert.equal(result.research?.assuranceVersion, 2)
    assert(result.research.reads.length >= 2, 'Original author/reviewer reads must be recorded by actual tool events')
    assert(result.research.sourceBundle.cited.some(source => source.readIds.length >= 2))
    assert(result.research.claims.some(claim => claim.review?.support === 'supported' && claim.reviewer?.sessionId !== claim.producedBy.sessionId))
    assert.equal(result.research.blockers.length, 0)
  }
  if (errata) {
    assert(result.research!.errata.length > 0, 'Independent source review must append an exact-version correction')
    assert(result.research!.errata.every(item => item.state === 'resolved' && result.research!.report?.erratumIds?.includes(item.id)))
    assert(result.research!.claims.some(claim => claim.version > 1 && claim.review?.support === 'supported'), 'Corrected conclusions require new versions and fresh independent review')
    assert.equal(result.research!.lines.length, 1, 'A factual correction must preserve its original research premise')
  }
  if (repair) assert(events.some(event => event.kind === 'orchestration-patch') || events.some(event => event.kind === 'node-verdict' && event.result === 'fail'), 'The erroneous draft must trigger a recorded correction or result-driven plan revision')
  console.log(JSON.stringify({ ...record, result: undefined }, null, 2))
} finally { await manager.flushAllSessions(); manager.cleanup() }
