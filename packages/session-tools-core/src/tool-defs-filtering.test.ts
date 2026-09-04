import { describe, expect, it } from 'bun:test';
import {
  SESSION_TOOL_DEFS,
  SubmitOrchestrationDecisionSchema,
  SubmitTaskNodeVerdictSchema,
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
} from './tool-defs.ts';

describe('session tool filtering helpers', () => {
  it('respects developer feedback filtering and keeps names/registry aligned', () => {
    expect(getSessionToolDefs({ includeDeveloperFeedback: false }).map(def => def.name))
      .not.toContain('send_developer_feedback');
    expect(getSessionToolDefs({ includeDeveloperFeedback: true }).map(def => def.name))
      .toContain('send_developer_feedback');

    const names = getSessionToolNames({ includeDeveloperFeedback: false });
    const registry = getSessionToolRegistry({ includeDeveloperFeedback: false });
    for (const name of names) expect(registry.has(name)).toBe(true);
    expect(registry.has('send_developer_feedback')).toBe(false);
  });

  it('classifies developer feedback as a safe-mode mutation', () => {
    expect(getSessionSafeAllowedToolNames({ includeDeveloperFeedback: true }))
      .not.toContain('send_developer_feedback');
    expect(getSessionSafeBlockedToolNames({ includeDeveloperFeedback: true }))
      .toContain('send_developer_feedback');
  });

  it('does not register native Office document tools', () => {
    const names = getSessionToolNames({ includeDeveloperFeedback: false });
    for (const name of [
      'office_document_inspect',
      'office_document_edit',
      'office_document_guide',
      'office_document_preview',
      'office_document_finalize',
    ]) {
      expect(names.has(name)).toBe(false);
    }
  });

  it('never registers typed OfficeCLI tools', () => {
    const names = getSessionToolNames();
    for (const removedSuffix of ['batch', 'qa', 'finalize']) {
      expect(names.has(`officecli_${removedSuffix}`)).toBe(false);
    }
  });

  it('all canonical session tools declare safeMode metadata', () => {
    for (const def of SESSION_TOOL_DEFS) {
      expect(def.safeMode === 'allow' || def.safeMode === 'block').toBe(true);
    }
  });

  it('keeps safe-mode allow/block sets disjoint', () => {
    const allowed = getSessionSafeAllowedToolNames();
    const blocked = getSessionSafeBlockedToolNames();
    for (const name of allowed) expect(blocked.has(name)).toBe(false);
  });

  it('rejects incomplete fail node verdicts and patch decisions at the tool schema', () => {
    expect(SubmitTaskNodeVerdictSchema.safeParse({ result: 'fail', reason: 'bad' }).success).toBe(false);
    expect(SubmitTaskNodeVerdictSchema.safeParse({
      result: 'fail',
      reason: 'bad',
      evidence: 'proof',
      nodes: ['work'],
    }).success).toBe(true);
    expect(SubmitOrchestrationDecisionSchema.safeParse({
      runId: 'r1',
      checkpointId: 'cp',
      decisionId: 'd1',
      baseRevision: 0,
      action: 'patch',
    }).success).toBe(false);
    expect(SubmitOrchestrationDecisionSchema.safeParse({
      runId: 'r1',
      checkpointId: 'cp',
      decisionId: 'd1',
      baseRevision: 0,
      action: 'patch',
      rationale: 'add a missing branch',
    }).success).toBe(true);
  });
});
