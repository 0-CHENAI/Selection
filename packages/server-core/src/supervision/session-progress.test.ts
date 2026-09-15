import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager, createManagedSession } from '../sessions/SessionManager'
import { readProgressCheckpoint } from './progress-store'
import { createTypedError } from '@craft-agent/shared/agent/errors'
import { getSessionPath } from '@craft-agent/shared/sessions'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
function setup(terminal?: 'output_limit' | 'stream_interrupted' | 'model_request_timeout') {
  const root = mkdtempSync(join(tmpdir(), 'progress-integration-')); roots.push(root)
  writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'ws', name: 'test', slug: 'test', progressSupervision: { mode: 'observe' } }))
  const manager = new SessionManager()
  const managed = createManagedSession({ id: 'progress', name: 'progress' }, { id: 'ws', name: 'test', rootPath: root, createdAt: 1 } as never, { messagesLoaded: true })
  ;(manager as any).sessions.set(managed.id, managed)
  manager.setEventSink(() => {})
  const entered = deferred(); const interrupted = deferred(); let calls = 0; let control: any
  const prompts: string[] = []
  const agent = {
    destroy() {}, getModel: () => 'Laufry', getSessionId: () => 'sdk-candidate', setAllSources() {},
    configureAnswerDelivery(value: any) { control = value },
    async interruptForProgress() { interrupted.resolve() },
    forceAbort() { interrupted.resolve() },
    async *chat(prompt: string) {
      prompts.push(prompt); calls++
      yield { type: 'model_call_start' as const }
      if (calls === 1) {
        yield { type: 'tool_start' as const, toolUseId: 'read', toolName: 'Read', input: {} }
        yield { type: 'tool_result' as const, toolUseId: 'read', toolName: 'Read', result: '约束已经明确', isError: false }
        entered.resolve(); await interrupted.promise
        if (terminal) yield { type: 'typed_error' as const, error: createTypedError(terminal) }
      } else {
        await control.submit({ markdown: '完整交付', toolCallId: 'answer', sdkMessageId: 'sdk', sdkTurnAnchor: 'anchor' })
      }
      yield { type: 'complete' as const }
    },
  }
  ;(manager as any).getOrCreateAgent = async () => { managed.agent = agent as never; return agent }
  ;(manager as any).createProgressReviewer = () => ({ destroy() {}, async queryLlm(request: any) {
    const snapshot = JSON.parse(request.prompt)
    return { model: 'Laufry', inputTokens: 100, outputTokens: 20, text: JSON.stringify({
      action: 'redirect', basis: 'task-evidence', scope: 'execution', summary: '约束已明确，可生成初版',
      evidenceIds: snapshot.evidence.filter((e: any) => e.kind === 'tool').map((e: any) => e.id),
      nextStep: '生成初版', expectedResult: '获得可验证文件', interruptionRisk: '无活动工具', nextCheckSeconds: 60,
    }) }
  } })
  return { root, manager, managed, agent, entered, interrupted, prompts }
}
describe('SessionManager progress integration', () => {
  it('drains the original call and delivers once within the same user turn', async () => {
    const f = setup(); const run = f.manager.sendMessage(f.managed.id, '画图')
    await f.entered.promise
    const supervisor = f.managed.progressSupervisor!
    supervisor.setMode('assist')
    const snapshot = (supervisor as any).options.snapshot
    ;(supervisor as any).options.snapshot = () => ({ ...snapshot(), elapsedMs: 100_000 })
    await supervisor.tick(); await run; await f.manager.flushSession(f.managed.id)
    expect(f.prompts).toHaveLength(2)
    expect(f.prompts[1]).toContain('生成初版')
    expect(f.managed.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(f.managed.messages.filter(m => m.answerCommitted)).toHaveLength(1)
    expect(f.managed.progressSupervision?.evaluationTokens).toBe(120)
  })
  it('continues a saved checkpoint once and keeps the answer identity', async () => {
    const f = setup('model_request_timeout'); const run = f.manager.sendMessage(f.managed.id, '画图'); await f.entered.promise;
    f.interrupted.resolve(); await run;
    const runId = f.managed.messages.find(m => m.role === 'user')!.answerRunId;
    await f.manager.continueProgress(f.managed.id);
    expect(f.prompts).toHaveLength(2);
    expect(f.managed.messages.find(m => m.answerCommitted)?.answerRunId).toBe(runId);
    await expect(f.manager.continueProgress(f.managed.id)).rejects.toThrow('No pending');
    await f.manager.flushSession(f.managed.id);
  });

  it('does not redirect after the user stops during evaluation', async () => {
    const f = setup(); const run = f.manager.sendMessage(f.managed.id, '画图'); await f.entered.promise;
    const ready = deferred(); let resolve!: (value: unknown) => void;
    (f.manager as any).createProgressReviewer = () => ({ destroy() {}, queryLlm: async () => { ready.resolve(); return new Promise(r => { resolve = r }) } });
    const supervisor = f.managed.progressSupervisor!; supervisor.setMode('assist');
    const snapshot = (supervisor as any).options.snapshot;
    (supervisor as any).options.snapshot = () => ({ ...snapshot(), elapsedMs: 100_000 });
    const evaluation = supervisor.tick(); await ready.promise;
    await f.manager.cancelProcessing(f.managed.id, true); resolve({ text: '{}', model: 'Laufry', inputTokens: 10, outputTokens: 2 });
    await evaluation; await run; expect(f.prompts).toHaveLength(1); await f.manager.flushSession(f.managed.id);
  });

  it('restores the old answer on regeneration pause and resumes the candidate history', async () => {
    const f = setup('model_request_timeout');
    f.managed.sdkSessionId = 'sdk-old';
    f.managed.messages = [
      { id: 'user', role: 'user', content: '画图', timestamp: 1, answerRunId: 'old-run' },
      { id: 'old', role: 'assistant', content: '旧答案', timestamp: 2, answerRunId: 'old-run', answerCommitted: true },
    ];
    await f.manager.regenerateLastResponse(f.managed.id); await f.entered.promise;
    f.interrupted.resolve();
    for (let i = 0; i < 100 && f.managed.isProcessing; i++) await new Promise(r => setTimeout(r, 5));
    expect(f.managed.isProcessing).toBe(false);
    expect(f.managed.messages.some(m => m.id === 'old')).toBe(true);
    expect(f.managed.sdkSessionId).toBe('sdk-old');
    await f.manager.continueProgress(f.managed.id);
    expect(f.managed.messages.filter(m => m.answerCommitted).map(m => m.content)).toEqual(['完整交付']);
    expect(f.managed.messages.find(m => m.answerCommitted)?.answerRunId).not.toBe('old-run');
    await f.manager.flushSession(f.managed.id);
  });

  it.each(['output_limit', 'stream_interrupted', 'model_request_timeout'] as const)('preserves a resumable checkpoint for %s without answer-only retry', async terminal => {
    const f = setup(terminal); const run = f.manager.sendMessage(f.managed.id, '画图');
    await f.entered.promise; f.interrupted.resolve(); await run;
    expect(f.prompts).toHaveLength(1);
    expect(f.managed.progressSupervision?.phase).toBe('paused');
    expect(f.managed.messages.filter(m => m.errorCode === (terminal === 'model_request_timeout' ? 'call_time_limit' : terminal))).toHaveLength(1);
    expect(readProgressCheckpoint(getSessionPath(f.root, f.managed.id))?.continuation?.consumed).toBe(false);
    await f.manager.flushSession(f.managed.id);
  });

  it('limits Swarm parent evaluation by the shared root usage and reservations', async () => {
    const f = setup(); const run = f.manager.sendMessage(f.managed.id, '画图')
    await f.entered.promise
    const options = (f.managed.progressSupervisor as any).options
    ;(f.manager as any).getManagedSwarmChildren = () => [{ id: 'worker', messages: [], orchestrationStatus: 'running' }]
    const initial = options.evaluationAllowance()
    options.rootBudget.tokens = initial - 100
    options.rootBudget.reserved = 60
    expect(options.evaluationAllowance()).toBeCloseTo(40)
    f.interrupted.resolve(); await run; await f.manager.flushSession(f.managed.id)
  })

  it('does not pause a long model call just because wall time elapsed', async () => {
    const f = setup(); const run = f.manager.sendMessage(f.managed.id, '画图')
    await f.entered.promise
    const supervisor = f.managed.progressSupervisor!
    const snapshot = (supervisor as any).options.snapshot
    ;(supervisor as any).options.snapshot = () => ({ ...snapshot(), elapsedMs: 600_000 })
    await supervisor.tick()
    expect(f.prompts).toHaveLength(1)
    expect(f.managed.isProcessing).toBe(true)
    expect(f.managed.messages.some(m => m.errorCode === 'call_time_limit')).toBe(false)
    f.interrupted.resolve(); await run; await f.manager.flushSession(f.managed.id)
  })
})
