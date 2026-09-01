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
          return { status: 'running', revision: 0 };
        },
      } as unknown as SessionToolContext,
      { runId: 'r1', checkpointId: 'cp', decisionId: 'd1', baseRevision: 0, action: 'continue' },
    );
    expect(ok.content[0]?.text).toContain('running');
    expect(called).toHaveLength(1);
  });
});
