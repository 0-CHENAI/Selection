import type { AnswerDeliveryControl } from './backend/types.ts';

export function isSubmitAnswer(name: string): boolean {
  return name === 'submit_answer' || name === 'mcp__session__submit_answer' || name === 'session__submit_answer';
}

/** Used at both permission and actual execution boundaries. */
export function answerToolBlock(control: AnswerDeliveryControl | undefined, accepted: boolean, toolName: string, runId?: string): string | undefined {
  if (!control) return isSubmitAnswer(toolName) ? 'Answer delivery is unavailable in this session.' : undefined;
  if (runId !== control.runId || !control.isActive()) return 'This answer delivery turn is no longer active.';
  if (accepted) return 'The answer has already been delivered. No further tools may execute.';
  if (control.recovery && !isSubmitAnswer(toolName)) return 'Only submit_answer is allowed during answer recovery. Do not repeat business tools.';
  return undefined;
}
