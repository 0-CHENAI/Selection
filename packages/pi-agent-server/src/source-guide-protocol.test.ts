import { describe, expect, it } from 'bun:test';
import {
  formatSourceGuidePreparationResult,
  getSourceGuidePreparationFailure,
  SourceGuideEventGate,
  type SourceGuidePreparation,
} from './source-guide-protocol.ts';

function preparation(overrides: Partial<SourceGuidePreparation> = {}): SourceGuidePreparation {
  return {
    sourceSlug: 'anysearch',
    guidePath: '/workspace/sources/anysearch/guide.md',
    guideContent: 'Prefer official sources.',
    guideVersion: 'version-1',
    assistantGeneration: 3,
    alreadyPreparedInGeneration: false,
    ...overrides,
  };
}

describe('source guide preparation protocol', () => {
  it('provides real guide instructions and makes non-execution explicit', () => {
    const result = formatSourceGuidePreparationResult(preparation());
    expect(result).toContain('Prefer official sources.');
    expect(result).toContain('NOT executed');
    expect(result).toContain('issue a new tool call');
  });

  it('does not duplicate guide content for sibling calls', () => {
    const result = formatSourceGuidePreparationResult(preparation({
      alreadyPreparedInGeneration: true,
    }));
    expect(result).not.toContain('Prefer official sources.');
    expect(result).toContain('another internal result');
    expect(result).toContain('NOT executed');
  });

  it('releases real source tool starts and hides preparation starts/results', () => {
    const gate = new SourceGuideEventGate<{ id: string }>();
    gate.bufferStart('real-call', { id: 'real-call' });
    expect(gate.releaseStart('real-call')).toEqual({ id: 'real-call' });
    expect(gate.releaseStart('real-call')).toBeUndefined();

    gate.bufferStart('internal-call', { id: 'internal-call' });
    gate.suppress('internal-call', preparation());
    expect(gate.releaseStart('internal-call')).toBeUndefined();
    expect(gate.consumeSuppressed('internal-call')?.sourceSlug).toBe('anysearch');
    expect(gate.consumeSuppressed('internal-call')).toBeUndefined();
  });

  it('clears buffered and suppressed events after reset', () => {
    const gate = new SourceGuideEventGate<{ id: string }>();
    gate.bufferStart('buffered', { id: 'buffered' });
    gate.suppress('suppressed', preparation());
    gate.clear();
    expect(gate.releaseStart('buffered')).toBeUndefined();
    expect(gate.consumeSuppressed('suppressed')).toBeUndefined();
  });

  it('extracts meaningful internal preparation failures without hiding proxy errors', () => {
    expect(getSourceGuidePreparationFailure(false, {
      content: [{ type: 'text', text: 'The context could not be updated.' }],
      details: { isError: true },
    })).toBe('The context could not be updated.');

    expect(getSourceGuidePreparationFailure(true, {
      content: [{ type: 'text', text: 'Source instructions were rejected.' }],
    })).toBe('Source instructions were rejected.');

    expect(getSourceGuidePreparationFailure(true, {}))
      .toContain('Source instructions could not be delivered');
    expect(getSourceGuidePreparationFailure(false, { details: { isError: false } }))
      .toBeNull();
  });
});
