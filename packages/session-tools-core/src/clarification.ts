/**
 * User-facing clarification contract shared by NORM and PRO.
 * The host owns the question cap; this module is the tool-facing gate.
 */

export interface ClarificationOption {
  id: string;
  label: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  selection: 'single' | 'multi';
  options: ClarificationOption[];
}

export interface ClarificationAsk {
  question: string;
  /** One step-by-step card. Omit for a single-question call (legacy). */
  questions?: ClarificationQuestion[];
  ambiguity: 'goal' | 'scope' | 'constraints';
  selection: 'single' | 'multi';
  options: ClarificationOption[];
  critical?: boolean;
}

export type ClarificationGate =
  | { accepted: true; requestId: string; round: number }
  | { accepted: false; reason: string };

export function normalizeClarificationAsk(ask: ClarificationAsk): ClarificationAsk & { questions: ClarificationQuestion[] } {
  if (ask.questions && ask.questions.length > 0) {
    return { ...ask, questions: ask.questions };
  }
  return {
    ...ask,
    questions: [{
      id: 'q1',
      question: ask.question,
      selection: ask.selection,
      options: ask.options,
    }],
  };
}
