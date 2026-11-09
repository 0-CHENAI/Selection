/**
 * Structured condition AST for v2 tasks. No JavaScript evaluation.
 */
import { CONDITION_OPS, type ConditionAst, type ConditionAst as Condition } from './schema.ts';

export type { Condition, ConditionAst };
export type ConditionOp = (typeof CONDITION_OPS)[number];

export function isConditionLeaf(c: Condition): c is { ref: string; op: ConditionOp; value?: unknown } {
  return 'ref' in c && 'op' in c;
}

function resolveRef(ref: string, ctx: Record<string, unknown>): unknown {
  const parts = ref.replace(/^\$\{|\}$/g, '').split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function cmp(op: ConditionOp, left: unknown, right: unknown): boolean {
  switch (op) {
    case 'exists':
      return left !== undefined && left !== null && left !== '';
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
    case 'contains':
      return String(left ?? '').includes(String(right ?? ''));
    case 'in':
      return Array.isArray(right) && right.includes(left);
    default:
      return false;
  }
}

export function evaluateCondition(cond: Condition, ctx: Record<string, unknown>): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, ctx));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, ctx));
  if ('not' in cond) return !evaluateCondition(cond.not, ctx);
  return cmp(cond.op, resolveRef(cond.ref, ctx), cond.value);
}

/** v1 `when: string` becomes an exists-check; the original string is the ref. */
export function conditionFromLegacyWhen(when: string): Condition {
  return { ref: when, op: 'exists' };
}
