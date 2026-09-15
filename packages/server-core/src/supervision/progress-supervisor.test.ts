import { describe, expect, it } from 'bun:test'
import { ProgressSupervisor, createProgressBudget, PROGRESS_POLICY, type ProgressAssessment, type ProgressSnapshot } from './progress-supervisor'

const assessment = (action: ProgressAssessment['action']): ProgressAssessment => ({ action, summary: '工具结果表明约束已经明确',
  evidenceIds: ['tool-1'], basis: 'task-evidence', scope: 'execution', nextStep: '写入初版文件',
  expectedResult: '得到可检查的 HTML', interruptionRisk: '没有正在执行的工具', nextCheckSeconds: 60 })
function fixture(action: ProgressAssessment['action'] = 'redirect') {
  let clock = 100_000
  const snap: ProgressSnapshot = { sessionId: 's', taskId: 'u', generation: 1, revision: 1, callId: 'c', status: 'model',
    evidence: [{ id: 'u', kind: 'goal', text: '生成架构图' }, { id: 'tool-1', kind: 'tool', text: '参考读取完成' }], elapsedMs: 100_000, executionTokens: 500 }
  const decisions: unknown[] = []; const pauses: string[] = []; const charges: number[] = []
  const budget = createProgressBudget()
  const options = { mode: 'assist' as const, rootBudget: budget, now: () => clock, snapshot: () => snap,
    query: async (_request: unknown, _signal: AbortSignal) => ({ text: JSON.stringify(assessment(action)), model: 'Laufry', inputTokens: 100, outputTokens: 30 }),
    decide: async (decision: unknown) => { decisions.push(decision); return true },
    pause: async (reason: string) => { pauses.push(reason) }, change: () => {}, charge: (tokens: number) => { charges.push(tokens) }, evaluationAllowance: () => 32_000 }
  return { options, snap, decisions, pauses, charges, budget, advance: () => { clock += 60_000 } }
}
describe('semantic progress supervision', () => {
  it('uses task evidence to redirect and accounts actual evaluation usage', async () => {
    const f = fixture(); const s = new ProgressSupervisor(f.options); await s.tick()
    expect(f.decisions).toHaveLength(1); expect(f.budget.tokens).toBe(130); expect(f.budget.reserved).toBe(0)
  })
  it.each(['continue', 'uncertain'] as const)('does not interrupt %s even after a long reasoning interval', async action => {
    const f = fixture(action); await new ProgressSupervisor(f.options).tick()
    expect(f.decisions).toHaveLength(0); expect(f.pauses).toHaveLength(0)
  })
  it('does not turn elapsed time into a semantic failure', async () => {
    const f = fixture(); f.options.query = async () => ({ text: JSON.stringify({ ...assessment('redirect'), basis: 'insufficient-evidence' }), model: 'Laufry', inputTokens: 100, outputTokens: 30 })
    await new ProgressSupervisor(f.options).tick(); expect(f.decisions).toHaveLength(0)
  })
  it('rejects invented evidence', async () => {
    const f = fixture(); f.options.query = async () => ({ text: JSON.stringify({ ...assessment('redirect'), evidenceIds: ['invented'] }), model: 'Laufry', inputTokens: 100, outputTokens: 30 })
    await new ProgressSupervisor(f.options).tick(); expect(f.decisions).toHaveLength(0)
  })
  it('discards decisions after tool results change the snapshot', async () => {
    const f = fixture(); const query = f.options.query
    f.options.query = async (r, signal) => { const result = await query(r, signal); f.snap.revision++; return result }
    await new ProgressSupervisor(f.options).tick(); expect(f.decisions).toHaveLength(0)
  })
  it('respects tool, worker, compaction and handoff boundaries', async () => {
    for (const status of ['tool', 'waiting', 'compacting', 'handoff', 'complete'] as const) {
      const f = fixture(); f.snap.status = status; await new ProgressSupervisor(f.options).tick()
      expect(f.budget.checks).toBe(['tool', 'waiting'].includes(status) ? 1 : 0); expect(f.decisions).toHaveLength(0)
    }
  })
  it('keeps resource bounds in off mode', async () => {
    const f = fixture(); f.snap.elapsedMs = PROGRESS_POLICY.callTimeoutMs
    await new ProgressSupervisor({ ...f.options, mode: 'off' }).tick()
    expect(f.pauses).toHaveLength(1); expect(f.decisions).toHaveLength(0)
  })
  it('never executes an observe-mode decision', async () => {
    const f = fixture(); await new ProgressSupervisor({ ...f.options, mode: 'observe' }).tick()
    expect(f.budget.checks).toBe(1); expect(f.decisions).toHaveLength(0)
  })
  it('aborts the underlying evaluation on stop and keeps uncertain cost reserved', async () => {
    const f = fixture(); let aborted = false
    f.options.query = async (_r, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('abort')) }))
    const supervisor = new ProgressSupervisor(f.options); const pending = supervisor.tick(); supervisor.stop(); await pending
    expect(aborted).toBe(true); expect(f.decisions).toHaveLength(0); expect(f.budget.tokens).toBeGreaterThan(0)
  })
  it('does not postpone checks forever when many short calls produce repetitive tools', async () => {
    const f = fixture(); f.snap.elapsedMs = 0;
    const supervisor = new ProgressSupervisor(f.options); await supervisor.tick();
    expect(f.budget.checks).toBe(0);
    f.advance(); f.snap.callId = 'second'; await supervisor.tick();
    f.advance(); f.snap.callId = 'third'; await supervisor.tick();
    expect(f.budget.checks).toBe(1); expect(f.decisions).toHaveLength(1);
  })

  it('shares root budget limits across workers', async () => {
    const f = fixture(); f.budget.tokens = 31_999
    await new ProgressSupervisor(f.options).tick(); expect(f.budget.checks).toBe(0)
  })
  it('does not accept another model as Laufry', async () => {
    const f = fixture(); const query = f.options.query
    f.options.query = async (r, signal) => ({ ...await query(r, signal), model: 'other' })
    await new ProgressSupervisor(f.options).tick(); expect(f.decisions).toHaveLength(0)
  })
})
