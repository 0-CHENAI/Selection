import { describe, expect, it } from 'bun:test';
import { evaluateCondition, conditionFromLegacyWhen } from './conditions.ts';

describe('evaluateCondition', () => {
  const ctx = { params: { n: 3, name: 'ada' }, nodes: { a: { output: 'hello' } } };

  it('evaluates leaf ops', () => {
    expect(evaluateCondition({ ref: 'params.n', op: 'eq', value: 3 }, ctx)).toBe(true);
    expect(evaluateCondition({ ref: 'params.n', op: 'gt', value: 1 }, ctx)).toBe(true);
    expect(evaluateCondition({ ref: 'params.name', op: 'contains', value: 'da' }, ctx)).toBe(true);
    expect(evaluateCondition({ ref: 'params.missing', op: 'exists' }, ctx)).toBe(false);
  });

  it('combines all/any/not', () => {
    expect(
      evaluateCondition(
        { all: [{ ref: 'params.n', op: 'gte', value: 3 }, { ref: 'params.name', op: 'eq', value: 'ada' }] },
        ctx,
      ),
    ).toBe(true);
    expect(evaluateCondition({ not: { ref: 'params.n', op: 'eq', value: 9 } }, ctx)).toBe(true);
    expect(
      evaluateCondition({ any: [{ ref: 'params.n', op: 'eq', value: 0 }, { ref: 'params.n', op: 'eq', value: 3 }] }, ctx),
    ).toBe(true);
  });

  it('migrates a v1 when-string to exists', () => {
    expect(conditionFromLegacyWhen('nodes.a.output')).toEqual({ ref: 'nodes.a.output', op: 'exists' });
  });
});
