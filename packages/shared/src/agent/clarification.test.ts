import { expect, test } from 'bun:test';
import type { Message } from '@craft-agent/core/types';
import {
  canSubmitClarification,
  clarificationContinuation,
  countClarificationRounds,
  decideClarification,
  hasPendingOriginClarification,
  normalizeClarificationResponse,
  toggleClarificationSelection,
} from './clarification.ts';

const ask = {
  selection: 'multi' as const,
  options: [{ id: 'a', label: '范围 A' }, { id: 'b', label: '范围 B' }],
};

function card(round: number, mirror = false): Message {
  return {
    id: `c${round}${mirror ? 'm' : ''}`,
    role: 'clarification',
    content: '问题',
    timestamp: round,
    clarification: {
      requestId: `r${round}`,
      question: '问题',
      ambiguity: 'scope',
      selection: 'single',
      options: [],
      round,
      status: 'pending',
      originSessionId: 'origin',
      ...(mirror ? { mirror: true } : {}),
    },
  };
}

test('soft cap allows three, one critical extra, then stops', () => {
  expect(decideClarification(0, false)).toEqual({ allow: true, round: 1 });
  expect(decideClarification(2, false)).toEqual({ allow: true, round: 3 });
  expect(decideClarification(3, false).allow).toBe(false);
  expect(decideClarification(3, true)).toEqual({ allow: true, round: 4 });
  expect(decideClarification(4, true).allow).toBe(false);
  if (!decideClarification(4, true).allow) {
    expect(decideClarification(4, true)).toMatchObject({ allow: false });
  }
});

test('rounds reset on a visible user message and ignore mirrors and hidden continuations', () => {
  const hidden: Message = { id: 'h', role: 'user', content: 'continuation', timestamp: 9, hidden: true };
  const visible: Message = { id: 'u', role: 'user', content: '新请求', timestamp: 10 };
  expect(countClarificationRounds([visible, card(1), card(2), hidden, card(3, true)])).toBe(2);
  expect(countClarificationRounds([card(1), card(2), card(3), visible, card(4)])).toBe(1);
});

test('a response can be options, text, both, or skip', () => {
  expect(canSubmitClarification({ skipped: false, optionIds: [], text: '  ' })).toBe(false);
  expect(canSubmitClarification({ skipped: true, optionIds: [], text: '' })).toBe(true);
  expect(normalizeClarificationResponse(ask, { skipped: false, optionIds: ['a'], text: '' })).toMatchObject({
    ok: true, optionIds: ['a'], labels: ['范围 A'], text: '',
  });
  expect(normalizeClarificationResponse(ask, { skipped: false, optionIds: [], text: '只要这一段' })).toMatchObject({
    ok: true, optionIds: [], text: '只要这一段',
  });
  expect(normalizeClarificationResponse(ask, { skipped: false, optionIds: ['b'], text: '再补充' })).toMatchObject({
    ok: true, labels: ['范围 B'], text: '再补充',
  });
  expect(normalizeClarificationResponse({ selection: 'single', options: ask.options }, {
    skipped: false, optionIds: ['a', 'b'], text: '',
  }).ok).toBe(false);
  const skipped = normalizeClarificationResponse(ask, { skipped: true, optionIds: ['a'], text: '忽略' });
  expect(skipped).toMatchObject({ ok: true, skipped: true, optionIds: [], text: '' });
  if (skipped.ok && skipped.skipped) {
    expect(clarificationContinuation({ requestId: 'r', ...skipped })).toContain('skipped');
  }
});

test('a pending origin card blocks another ask, and a mirror does not', () => {
  expect(hasPendingOriginClarification([card(1)])).toBe(true);
  expect(hasPendingOriginClarification([card(1, true)])).toBe(false);
  const answered = card(1);
  answered.clarification!.status = 'answered';
  expect(hasPendingOriginClarification([answered, card(2, true)])).toBe(false);
});

test('a malformed or oversized reply cannot submit an empty card', () => {
  expect(normalizeClarificationResponse(ask, { skipped: false }).ok).toBe(false);
  expect(normalizeClarificationResponse(ask, { skipped: false, optionIds: ['missing'], text: '  ' }).ok).toBe(false);
  const long = normalizeClarificationResponse(ask, { skipped: false, text: 'x'.repeat(2500) });
  expect(long).toMatchObject({ ok: true, text: 'x'.repeat(2000) });
});

test('single select replaces and multi select toggles', () => {
  expect(toggleClarificationSelection('single', [], 'a')).toEqual(['a']);
  expect(toggleClarificationSelection('single', ['a'], 'b')).toEqual(['b']);
  expect(toggleClarificationSelection('single', ['a'], 'a')).toEqual([]);
  expect(toggleClarificationSelection('multi', ['a'], 'b')).toEqual(['a', 'b']);
  expect(toggleClarificationSelection('multi', ['a', 'b'], 'a')).toEqual(['b']);
});
