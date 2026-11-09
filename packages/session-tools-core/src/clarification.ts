/**
 * User-facing clarification contract shared by NORM and PRO.
 * The host owns the round cap; this module is the tool-facing gate.
 */

export interface ClarificationOption {
  id: string;
  label: string;
}

export interface ClarificationAsk {
  question: string;
  ambiguity: 'goal' | 'scope' | 'constraints';
  selection: 'single' | 'multi';
  options: ClarificationOption[];
  critical?: boolean;
}

export type ClarificationGate =
  | { accepted: true; requestId: string; round: number }
  | { accepted: false; reason: string };
