/**
 * Round cap and answer normalization for the clarification card.
 *
 * Prefer at most 3 questions for one user request. One more is allowed only
 * when the caller marks it critically still ambiguous. After that, continue.
 */

import type { ClarificationState, Message } from '@craft-agent/core/types';
import type { ClarificationAsk } from '@craft-agent/session-tools-core';

export const CLARIFICATION_SOFT_CAP = 3;
export const CLARIFICATION_HARD_CAP = 4;

type ClarificationMessage = Pick<Message, 'role' | 'hidden' | 'clarification'>;

export function countClarificationRounds(messages: readonly ClarificationMessage[]): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'user' && !message.hidden) break;
    if (message.role === 'clarification' && message.clarification && !message.clarification.mirror) count += 1;
  }
  return count;
}

export function decideClarification(
  roundsUsed: number,
  critical: boolean,
): { allow: true; round: number } | { allow: false; reason: string } {
  if (roundsUsed >= CLARIFICATION_HARD_CAP) {
    return {
      allow: false,
      reason: 'Clarification limit reached. Continue with your best current understanding and do not call clarify again for this request.',
    };
  }
  if (roundsUsed >= CLARIFICATION_SOFT_CAP && !critical) {
    return {
      allow: false,
      reason: 'Already asked 3 clarifications. If the goal, scope, or constraints are still critically ambiguous, call clarify once more with critical=true. Otherwise continue with your best current understanding and do not ask again.',
    };
  }
  return { allow: true, round: roundsUsed + 1 };
}

export function toggleClarificationSelection(
  selection: ClarificationState['selection'],
  current: readonly string[],
  id: string,
): string[] {
  if (selection === 'single') return current.length === 1 && current[0] === id ? [] : [id];
  return current.includes(id) ? current.filter(item => item !== id) : [...current, id];
}

export function canSubmitClarification(input: { skipped: boolean; optionIds: readonly string[]; text: string }): boolean {
  if (input.skipped) return true;
  return input.optionIds.length > 0 || input.text.trim().length > 0;
}

export interface ClarificationResponseInput {
  skipped: boolean;
  optionIds?: string[];
  text?: string;
}

export function normalizeClarificationResponse(
  ask: Pick<ClarificationState, 'selection' | 'options'>,
  response: ClarificationResponseInput,
): { ok: true; skipped: boolean; optionIds: string[]; text: string; labels: string[] }
  | { ok: false; reason: string } {
  if (response.skipped) return { ok: true, skipped: true, optionIds: [], text: '', labels: [] };
  const known = new Set(ask.options.map(option => option.id));
  const optionIds = [...new Set((response.optionIds ?? []).filter(id => known.has(id)))];
  if (ask.selection === 'single' && optionIds.length > 1) {
    return { ok: false, reason: 'Choose at most one option.' };
  }
  const text = (response.text ?? '').trim().slice(0, 2000);
  if (!canSubmitClarification({ skipped: false, optionIds, text })) {
    return { ok: false, reason: 'Choose an option, type an answer, or skip.' };
  }
  const labels = ask.options.filter(option => optionIds.includes(option.id)).map(option => option.label);
  return { ok: true, skipped: false, optionIds, text, labels };
}

export function clarificationContinuation(input: {
  requestId: string;
  skipped: boolean;
  labels: readonly string[];
  text: string;
}): string {
  if (input.skipped) {
    return `Clarification ${input.requestId} was skipped. Continue with your current best understanding. Do not ask this question again.`;
  }
  const selected = input.labels.length > 0 ? input.labels.join('; ') : '(none)';
  const note = input.text.trim() || '(none)';
  return `Clarification ${input.requestId} answered. Selected: ${selected}. Note: ${note}. Use the selection and the note together when both are present. Continue the task. Do not repeat this question.`;
}

export function buildClarificationState(
  ask: ClarificationAsk,
  input: { requestId: string; round: number; originSessionId: string; mirror?: boolean },
): ClarificationState {
  return {
    requestId: input.requestId,
    question: ask.question,
    ambiguity: ask.ambiguity,
    selection: ask.selection,
    options: ask.options.map(option => ({ id: option.id, label: option.label })),
    round: input.round,
    status: 'pending',
    originSessionId: input.originSessionId,
    ...(input.mirror ? { mirror: true } : {}),
  };
}
