/**
 * Question cap and answer normalization for the clarification card.
 *
 * Prefer at most 3 questions for one user request. One more is allowed only
 * when the caller marks it critically still ambiguous. After that, continue.
 * The cap counts questions, not clarify calls: a batch of three in one card
 * uses the whole soft budget.
 */

import type { ClarificationQuestionState, ClarificationState, Message } from '@craft-agent/core/types';
import type { ClarificationAsk } from '@craft-agent/session-tools-core';

export const CLARIFICATION_SOFT_CAP = 3;
export const CLARIFICATION_HARD_CAP = 4;
export const LEGACY_CLARIFICATION_QUESTION_ID = 'q1';

type ClarificationMessage = Pick<Message, 'role' | 'hidden' | 'clarification'>;

export function hasPendingOriginClarification(messages: readonly ClarificationMessage[]): boolean {
  return messages.some(message =>
    message.role === 'clarification' && message.clarification?.status === 'pending' && !message.clarification.mirror);
}

type ClarificationQuestionSource = Pick<ClarificationState, 'question' | 'selection' | 'options'> &
  Partial<Pick<ClarificationState, 'questions' | 'status' | 'selectedOptionIds' | 'text'>>;

export function clarificationQuestions(state: ClarificationQuestionSource): ClarificationQuestionState[] {
  if (state.questions && state.questions.length > 0) return state.questions;
  return [{
    id: LEGACY_CLARIFICATION_QUESTION_ID,
    question: state.question,
    selection: state.selection,
    options: state.options,
    status: state.status,
    selectedOptionIds: state.selectedOptionIds,
    text: state.text,
  }];
}

export function countClarificationQuestionItems(state: Pick<ClarificationState, 'question' | 'selection' | 'options' | 'questions'>): number {
  return clarificationQuestions(state).length;
}

export function countClarificationRounds(messages: readonly ClarificationMessage[]): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'user' && !message.hidden) break;
    if (message.role === 'clarification' && message.clarification && !message.clarification.mirror) {
      count += countClarificationQuestionItems(message.clarification);
    }
  }
  return count;
}

export function decideClarification(
  questionsUsed: number,
  critical: boolean,
  incomingCount = 1,
): { allow: true; round: number } | { allow: false; reason: string } {
  const incoming = Math.max(0, incomingCount);
  const next = questionsUsed + incoming;
  if (incoming < 1) {
    return { allow: false, reason: 'clarify requires at least one question.' };
  }
  if (questionsUsed >= CLARIFICATION_HARD_CAP) {
    return {
      allow: false,
      reason: 'Clarification limit reached. Continue with your best current understanding and do not call clarify again for this request.',
    };
  }
  if (next > CLARIFICATION_HARD_CAP) {
    return {
      allow: false,
      reason: `This call asks ${incoming} questions, but only ${CLARIFICATION_HARD_CAP - questionsUsed} remain (hard cap ${CLARIFICATION_HARD_CAP} questions per user request). Drop or split questions, or continue with your best current understanding.`,
    };
  }
  if (next > CLARIFICATION_SOFT_CAP && !critical) {
    return {
      allow: false,
      reason: `Already asked ${questionsUsed} clarification question(s). This call asks ${incoming} more (${next} total). Prefer at most ${CLARIFICATION_SOFT_CAP} questions per visible user request (the cap counts questions, not calls). If the goal, scope, or constraints are still critically ambiguous, call clarify once more with critical=true for one extra question. Otherwise continue with your best current understanding and do not ask again.`,
    };
  }
  return { allow: true, round: next };
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

export interface ClarificationQuestionAnswerInput {
  questionId: string;
  skipped: boolean;
  optionIds?: string[];
  text?: string;
}

export interface ClarificationResponseInput {
  skipped?: boolean;
  optionIds?: string[];
  text?: string;
  answers?: ClarificationQuestionAnswerInput[];
}

export interface NormalizedClarificationAnswer {
  questionId: string;
  question: string;
  skipped: boolean;
  optionIds: string[];
  text: string;
  labels: string[];
}

function normalizeOneQuestion(
  question: ClarificationQuestionState,
  response: { skipped: boolean; optionIds?: string[]; text?: string },
): { ok: true; answer: NormalizedClarificationAnswer } | { ok: false; reason: string } {
  if (response.skipped) {
    return {
      ok: true,
      answer: {
        questionId: question.id,
        question: question.question,
        skipped: true,
        optionIds: [],
        text: '',
        labels: [],
      },
    };
  }
  const known = new Set(question.options.map(option => option.id));
  const rawIds = Array.isArray(response.optionIds) ? response.optionIds : [];
  const optionIds = [...new Set(rawIds.filter(id => typeof id === 'string' && known.has(id)))];
  if (question.selection === 'single' && optionIds.length > 1) {
    return { ok: false, reason: 'Choose at most one option.' };
  }
  const text = (typeof response.text === 'string' ? response.text : '').trim().slice(0, 2000);
  if (!canSubmitClarification({ skipped: false, optionIds, text })) {
    return {
      ok: true,
      answer: {
        questionId: question.id,
        question: question.question,
        skipped: true,
        optionIds: [],
        text: '',
        labels: [],
      },
    };
  }
  const labels = question.options.filter(option => optionIds.includes(option.id)).map(option => option.label);
  return {
    ok: true,
    answer: {
      questionId: question.id,
      question: question.question,
      skipped: false,
      optionIds,
      text,
      labels,
    },
  };
}

export function normalizeClarificationResponse(
  ask: Pick<ClarificationState, 'selection' | 'options' | 'question' | 'questions'>,
  response: ClarificationResponseInput,
): { ok: true; skipped: boolean; optionIds: string[]; text: string; labels: string[]; answers: NormalizedClarificationAnswer[] }
  | { ok: false; reason: string } {
  const questions = clarificationQuestions(ask);
  const byId = new Map(response.answers?.map(answer => [answer.questionId, answer]) ?? []);
  const answers: NormalizedClarificationAnswer[] = [];
  for (const question of questions) {
    const item = byId.get(question.id);
    const perQuestion = item
      ? { skipped: item.skipped === true, optionIds: item.optionIds, text: item.text }
      : response.answers
        ? { skipped: true, optionIds: [], text: '' }
        : response.skipped
          ? { skipped: true, optionIds: [], text: '' }
          : { skipped: false, optionIds: response.optionIds, text: response.text };
    if (questions.length > 1 && !response.answers && !response.skipped && question.id !== questions[0]?.id) {
      const rest = normalizeOneQuestion(question, { skipped: true });
      if (!rest.ok) return rest;
      answers.push(rest.answer);
      continue;
    }
    const normalized = normalizeOneQuestion(question, perQuestion);
    if (!normalized.ok) return normalized;
    answers.push(normalized.answer);
  }
  const first = answers[0];
  if (!first) return { ok: false, reason: 'Choose an option, type an answer, or skip.' };
  const skipped = answers.every(answer => answer.skipped);
  return {
    ok: true,
    skipped,
    optionIds: first.skipped ? [] : first.optionIds,
    text: first.skipped ? '' : first.text,
    labels: first.skipped ? [] : first.labels,
    answers,
  };
}

const SKIPPED_QUESTION_GUIDANCE = 'Proceed with your current understanding. In your reply, state what you assumed for this question so the user can correct it. Do not re-ask this question, except at most once if the skip would clearly make the result wrong (that re-ask counts against the question cap).';

export function clarificationContinuation(input: {
  requestId: string;
  skipped: boolean;
  labels: readonly string[];
  text: string;
  answers?: readonly NormalizedClarificationAnswer[];
}): string {
  if (input.answers && input.answers.length > 0) {
    const lines = input.answers.map(answer => {
      if (answer.skipped) {
        return `- [${answer.questionId}] SKIPPED — "${answer.question}". ${SKIPPED_QUESTION_GUIDANCE}`;
      }
      const selected = answer.labels.length > 0 ? answer.labels.join('; ') : '(none)';
      const note = answer.text.trim() || '(none)';
      return `- [${answer.questionId}] ANSWERED — "${answer.question}". Selected: ${selected}. Note: ${note}. Use the selection and the note together when both are present. Do not repeat this question.`;
    });
    return `Clarification ${input.requestId} submitted (${input.answers.length} questions).\n${lines.join('\n')}\nContinue the task.`;
  }
  if (input.skipped) {
    return `Clarification ${input.requestId} was skipped. Continue with your current best understanding. ${SKIPPED_QUESTION_GUIDANCE}`;
  }
  const selected = input.labels.length > 0 ? input.labels.join('; ') : '(none)';
  const note = input.text.trim() || '(none)';
  return `Clarification ${input.requestId} answered. Selected: ${selected}. Note: ${note}. Use the selection and the note together when both are present. Continue the task. Do not repeat this question.`;
}

function questionsFromAsk(ask: ClarificationAsk): ClarificationQuestionState[] {
  if (ask.questions && ask.questions.length > 0) {
    return ask.questions.map(question => ({
      id: question.id,
      question: question.question,
      selection: question.selection,
      options: question.options.map(option => ({ id: option.id, label: option.label })),
    }));
  }
  return [{
    id: LEGACY_CLARIFICATION_QUESTION_ID,
    question: ask.question,
    selection: ask.selection,
    options: ask.options.map(option => ({ id: option.id, label: option.label })),
  }];
}

export function buildClarificationState(
  ask: ClarificationAsk,
  input: { requestId: string; round: number; originSessionId: string; mirror?: boolean },
): ClarificationState {
  const questions = questionsFromAsk(ask);
  const first = questions[0]!;
  return {
    requestId: input.requestId,
    question: first.question,
    questions: questions.map(question => ({
      id: question.id,
      question: question.question,
      selection: question.selection,
      options: question.options.map(option => ({ id: option.id, label: option.label })),
    })),
    ambiguity: ask.ambiguity,
    selection: first.selection,
    options: first.options.map(option => ({ id: option.id, label: option.label })),
    round: input.round,
    status: 'pending',
    originSessionId: input.originSessionId,
    ...(input.mirror ? { mirror: true } : {}),
  };
}

export function applyClarificationAnswers(
  state: ClarificationState,
  result: { skipped: boolean; optionIds: string[]; text: string; answers: readonly NormalizedClarificationAnswer[] },
): ClarificationState {
  const answers = new Map(result.answers.map(answer => [answer.questionId, answer]));
  const questions = clarificationQuestions(state).map(question => {
    const answer = answers.get(question.id);
    if (!answer || answer.skipped) {
      return { ...question, status: 'skipped' as const, selectedOptionIds: [], text: '' };
    }
    return {
      ...question,
      status: 'answered' as const,
      selectedOptionIds: answer.optionIds,
      text: answer.text,
    };
  });
  return {
    ...state,
    status: result.skipped ? 'skipped' : 'answered',
    selectedOptionIds: result.optionIds,
    text: result.text,
    questions,
  };
}
