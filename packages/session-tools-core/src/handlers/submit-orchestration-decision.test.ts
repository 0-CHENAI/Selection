import { describe, expect, it } from 'bun:test';
import { handleSubmitOrchestrationDecision } from './submit-orchestration-decision.ts';
import type { OrchestrationDecisionInput, SessionToolContext } from '../context.ts';

describe('handleSubmitOrchestrationDecision', () => {
  it('requires the bound callback and checkpoint fields', async () => {
    const missing = await handleSubmitOrchestrationDecision({} as unknown as SessionToolContext, {
      runId: 'r1',
      checkpointId: 'cp',
      decisionId: 'd1',
      baseRevision: 0,
      action: 'continue',
    });
    expect(missing.content[0]?.text).toContain('not available');

    const called: unknown[] = [];
    const ok = await handleSubmitOrchestrationDecision(
      {
        submitOrchestrationDecision: async (input: OrchestrationDecisionInput) => {
          called.push(input);
          return { status: 'running', revision: 0, alreadyApplied: true };
        },
      } as unknown as SessionToolContext,
      { runId: 'r1', checkpointId: 'cp', decisionId: 'd1', baseRevision: 0, action: 'continue' },
    );
    expect(ok.content[0]?.text).toContain('running');
    expect(ok.content[0]?.text).toContain('"alreadyApplied": true');
    expect(called).toHaveLength(1);
  });
  it('includes the authoritative non-waiting state without directing another stale submission', async () => {
    const result = await handleSubmitOrchestrationDecision({
      submitOrchestrationDecision: async () => { throw Object.assign(new Error('current status is running; end this turn'), { code: 'conflict', currentRun: { runId: 'r1', status: 'running', revision: 2 } }); },
    } as unknown as SessionToolContext, { runId: 'r1', checkpointId: 'old', decisionId: 'd1', baseRevision: 0, action: 'continue' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ applied: false, currentRun: { status: 'running' } });
    expect(result.content[0]?.text).toContain('do not poll or resubmit');
  });
  it('directs an acknowledged duplicate to the newer gate instead of ending the turn', async () => {
    const result = await handleSubmitOrchestrationDecision({
      submitOrchestrationDecision: async () => ({ alreadyApplied: true, status: 'waiting-coordinator', coordinatorGate: { checkpointId: 'new' } }),
    } as unknown as SessionToolContext, { runId: 'r1', checkpointId: 'old', decisionId: 'd1', baseRevision: 0, action: 'continue' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('newer coordinator checkpoint remains pending');
    expect(result.content[0]?.text).not.toContain('End this assistant turn now');
  });
  it('never turns a human pause into an automatic resume or hides a real validation failure', async () => {
    for (const [status, checkpointId, isError] of [['paused', undefined, false], ['waiting-coordinator', 'current', true]] as const) {
      const result = await handleSubmitOrchestrationDecision({
        submitOrchestrationDecision: async () => { throw Object.assign(new Error('Plan change is not authorized'), {
          code: 'conflict', currentRun: { runId: 'r1', status, revision: 0, coordinatorGate: checkpointId ? { checkpointId } : undefined },
        }); },
      } as unknown as SessionToolContext, { runId: 'r1', checkpointId: 'current', decisionId: 'd1', baseRevision: 0, action: 'patch', rationale: 'change' });
      expect(result.isError).toBe(isError);
      if (status === 'paused') {
        expect(JSON.parse(result.content[0]!.text).applied).toBe(false);
        expect(result.content[0]!.text).toContain('do not resubmit or auto-resume');
      } else expect(result.content[0]!.text).toContain('[ERROR]');
    }
  });
});
