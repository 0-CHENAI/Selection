/** Opt-in real Laufry transport/semantic checks. This is not the full product acceptance matrix. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getLlmConnections } from '../packages/shared/src/config'
import { createBackendFromConnection } from '../packages/shared/src/agent/backend/factory'
import { ProgressSupervisor, createProgressBudget, type ProgressSnapshot } from '../packages/server-core/src/supervision/progress-supervisor'

const requested = process.argv[2]
const connections = getLlmConnections().filter(c => c.models?.some(m => (typeof m === 'string' ? m : m.id).replace(/^pi\//, '').toLowerCase() === 'laufry'))
const connection = requested ? connections.find(c => c.slug === requested) : connections.length === 1 ? connections[0] : undefined
if (!connection) throw new Error('Specify an existing Laufry connection slug as the first argument')
const root = mkdtempSync(join(tmpdir(), 'selection-progress-validation-'))
const agent = createBackendFromConnection(connection.slug, {
  workspace: { id: 'progress-validation', name: 'Progress validation', rootPath: root, createdAt: Date.now() },
  model: 'Laufry', miniModel: 'Laufry', isHeadless: true, queryOnly: true, skipConfigWatcher: true,
}, { appRootPath: resolve(import.meta.dir, '..'), isPackaged: false })
const cases = [
  { name: 'insufficient-reasoning-only', goal: '比较两个方案，证据充分后给出结论。', evidence: [], expected: ['uncertain', 'continue'] },
  { name: 'productive-long-analysis', goal: '证明算法在这些边界条件下正确。', evidence: [
    { id: 'finding', kind: 'text' as const, text: '已证明空输入和单元素情况；刚完成归纳步骤的不变量证明，正在检查相等元素边界。与上次相比已解决归纳步骤缺口。' },
  ], expected: ['continue'] },
  { name: 'change-failing-method', goal: '将已有表格转换成 SVG，保持数据不变。', evidence: [
    { id: 'contract', kind: 'tool' as const, text: '工具文档：export-svg 不接受 xlsx；必须先用 read-table 读取行数据，再调用 render-svg。两个操作均可用。' },
    { id: 'attempts', kind: 'tool' as const, text: '三次将相同 xlsx 直接交给 export-svg，均返回 unsupported input type。还没有调用 read-table。' },
  ], expected: ['redirect'] },
]
let failures = 0
try {
  for (const scenario of cases) for (let run = 1; run <= 3; run++) {
    const snapshot: ProgressSnapshot = { sessionId: 'validation', taskId: `${scenario.name}-${run}`, generation: 1,
      revision: 1, callId: 'call', status: 'model', elapsedMs: 100_000, executionTokens: 10_000,
      activity: { reasoningBytes: 50_000, textBytes: 0 },
      evidence: [{ id: 'goal', kind: 'goal', text: scenario.goal }, ...scenario.evidence] }
    const supervisor = new ProgressSupervisor({ mode: 'observe', rootBudget: createProgressBudget(), snapshot: () => snapshot,
      query: (request, signal) => agent.queryLlm!(request, signal), decide: async () => { throw new Error('Observe must not intervene') },
      pause: async () => { throw new Error('Fixture is below the resource boundary') }, change: () => {}, charge: () => {}, evaluationAllowance: () => 32_000 })
    const began = Date.now(); await supervisor.tick()
    const assessment = supervisor.state.lastDecision?.assessment
    const pass = !!assessment && scenario.expected.includes(assessment.action)
    if (!pass) failures++
    console.log(JSON.stringify({ scenario: scenario.name, run, pass, elapsedMs: Date.now() - began,
      tokens: supervisor.state.evaluationTokens, estimatedTokens: supervisor.state.estimatedTokens,
      assessment, unavailable: supervisor.state.reason }))
    await supervisor.drain()
  }
  const controller = new AbortController()
  const request = agent.queryLlm!({ purpose: 'progress-evaluation', model: 'Laufry', prompt: '详细分析一个复杂排序算法的所有边界条件。', maxTokens: 2048, timeoutMs: 45_000 }, controller.signal)
  const began = Date.now(); const timer = setTimeout(() => controller.abort(), 100)
  try { await request; console.log(JSON.stringify({ cancellation: 'completed-before-cancel' })); failures++ }
  catch { console.log(JSON.stringify({ cancellation: 'cancelled', elapsedMs: Date.now() - began })) }
  finally { clearTimeout(timer) }
} finally { agent.destroy(); rmSync(root, { recursive: true, force: true }) }
if (failures) process.exitCode = 1
