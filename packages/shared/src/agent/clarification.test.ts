import { expect, test } from 'bun:test';
import type { Message } from '@craft-agent/core/types';
import {
  canSubmitClarification,
  clarificationContinuation,
  clarificationQuestions,
  countClarificationRounds,
  decideClarification,
  hasPendingOriginClarification,
  normalizeClarificationResponse,
  toggleClarificationSelection,
} from './clarification.ts';

const ask = {
  question: '覆盖哪些年份？',
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

test('the cap counts questions in a batch, not clarify calls', () => {
  expect(decideClarification(0, false, 3)).toEqual({ allow: true, round: 3 });
  expect(decideClarification(0, false, 4).allow).toBe(false);
  expect(decideClarification(0, true, 4)).toEqual({ allow: true, round: 4 });
  expect(decideClarification(2, false, 2).allow).toBe(false);
  expect(decideClarification(2, true, 2)).toEqual({ allow: true, round: 4 });
  expect(decideClarification(3, true, 2).allow).toBe(false);
  expect(decideClarification(1, false, 3).allow).toBe(false);
});

test('rounds reset on a visible user message and ignore mirrors and hidden continuations', () => {
  const hidden: Message = { id: 'h', role: 'user', content: 'continuation', timestamp: 9, hidden: true };
  const visible: Message = { id: 'u', role: 'user', content: '新请求', timestamp: 10 };
  expect(countClarificationRounds([visible, card(1), card(2), hidden, card(3, true)])).toBe(2);
  expect(countClarificationRounds([card(1), card(2), card(3), visible, card(4)])).toBe(1);
});

test('a batch of questions counts toward the cap as its length', () => {
  const batch = card(1);
  batch.clarification = {
    ...batch.clarification!,
    questions: [
      { id: 'audience', question: '给谁看？', selection: 'single', options: [] },
      { id: 'years', question: '哪几年？', selection: 'multi', options: [] },
      { id: 'form', question: '什么形式？', selection: 'single', options: [] },
    ],
  };
  expect(countClarificationRounds([batch])).toBe(3);
  expect(clarificationQuestions(batch.clarification!).map(item => item.id)).toEqual(['audience', 'years', 'form']);
});

test('legacy cards without questions[] still count as one step', () => {
  expect(clarificationQuestions(card(1).clarification!).map(item => item.id)).toEqual(['q1']);
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
  expect(normalizeClarificationResponse({ selection: 'single', options: ask.options, question: ask.question }, {
    skipped: false, optionIds: ['a', 'b'], text: '',
  }).ok).toBe(false);
  const skipped = normalizeClarificationResponse(ask, { skipped: true, optionIds: ['a'], text: '忽略' });
  expect(skipped).toMatchObject({ ok: true, skipped: true, optionIds: [], text: '' });
  if (skipped.ok && skipped.skipped) {
    expect(clarificationContinuation({ requestId: 'r', ...skipped })).toContain('SKIPPED');
  }
});

test('a batch can mix answered and skipped questions', () => {
  const batch = {
    question: '给谁看？',
    selection: 'single' as const,
    options: [{ id: 'team', label: '业务团队' }],
    questions: [
      {
        id: 'audience',
        question: '这份报告主要给谁看？',
        selection: 'single' as const,
        options: [{ id: 'team', label: '业务团队' }, { id: 'exec', label: '管理层' }],
      },
      {
        id: 'years',
        question: '这次需要覆盖哪些年份？',
        selection: 'multi' as const,
        options: [{ id: '2025', label: '2025' }, { id: '2026', label: '2026' }],
      },
      {
        id: 'form',
        question: '交付形式更倾向哪种？',
        selection: 'single' as const,
        options: [{ id: 'slides', label: '幻灯片汇报' }, { id: 'doc', label: '书面报告' }],
      },
    ],
  };
  const mixed = normalizeClarificationResponse(batch, {
    answers: [
      { questionId: 'audience', skipped: false, optionIds: ['team'], text: '' },
      { questionId: 'years', skipped: true },
      { questionId: 'form', skipped: false, optionIds: ['doc'], text: '' },
    ],
  });
  expect(mixed.ok).toBe(true);
  if (!mixed.ok) return;
  expect(mixed.skipped).toBe(false);
  expect(mixed.answers.map(item => item.skipped)).toEqual([false, true, false]);
  expect(mixed.answers[1]?.labels).toEqual([]);
  const text = clarificationContinuation({ requestId: 'r1', ...mixed });
  expect(text).toContain('[audience] ANSWERED');
  expect(text).toContain('[years] SKIPPED');
  expect(text).toContain('state what you assumed');
  expect(text).toContain('[form] ANSWERED');
  expect(text).toContain('书面报告');
});

test('an empty question in a batch submits as skipped instead of rejecting the card', () => {
  const mixed = normalizeClarificationResponse(ask, {
    answers: [
      { questionId: 'q1', skipped: false, optionIds: [], text: '  ' },
    ],
  });
  expect(mixed).toMatchObject({ ok: true, skipped: true });
  if (mixed.ok) expect(mixed.answers[0]?.skipped).toBe(true);
});

test('a pending origin card blocks another ask, and a mirror does not', () => {
  expect(hasPendingOriginClarification([card(1)])).toBe(true);
  expect(hasPendingOriginClarification([card(1, true)])).toBe(false);
  const answered = card(1);
  answered.clarification!.status = 'answered';
  expect(hasPendingOriginClarification([answered, card(2, true)])).toBe(false);
});

test('a malformed or oversized reply cannot submit an empty card', () => {
  expect(normalizeClarificationResponse(ask, { skipped: false }).ok).toBe(true);
  expect(normalizeClarificationResponse(ask, { skipped: false }) ).toMatchObject({ ok: true, skipped: true });
  expect(normalizeClarificationResponse(ask, { skipped: false, optionIds: ['missing'], text: '  ' })).toMatchObject({
    ok: true, skipped: true,
  });
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
