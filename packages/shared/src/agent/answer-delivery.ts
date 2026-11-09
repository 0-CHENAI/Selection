import type { AnswerDeliveryControl } from './backend/types.ts';

export function isSubmitAnswer(name: string): boolean {
  return name === 'submit_answer' || name === 'mcp__session__submit_answer' || name === 'session__submit_answer';
}

const NATURAL_DELIVERY = 'There is no answer submission tool. End the turn with the final answer as plain text, without calling tools.';

/** Used at both permission and actual execution boundaries. */
export function answerToolBlock(control: AnswerDeliveryControl | undefined, accepted: boolean, toolName: string, runId?: string): string | undefined {
  // natural-v1: a remembered submit_answer call from older history never executes.
  if (isSubmitAnswer(toolName)) return NATURAL_DELIVERY;
  if (!control) return undefined;
  if (runId !== control.runId || !control.isActive()) return 'This answer delivery turn is no longer active.';
  if (accepted) return 'The answer has already been delivered. No further tools may execute.';
  if (control.recovery) return `Tools are unavailable during answer recovery. ${NATURAL_DELIVERY}`;
  return undefined;
}
