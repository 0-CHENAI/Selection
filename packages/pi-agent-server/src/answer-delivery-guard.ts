export function isAnswerTool(name: string): boolean {
  return name === 'submit_answer' || name === 'mcp__session__submit_answer' || name === 'session__submit_answer';
}

/** Guard the entire SDK tool batch, before any permission or execution request. */
export function answerExecutionError(state: { runId?: string; accepted: boolean; recovery: boolean; batchSize: number }, toolName: string): string | undefined {
  if (state.accepted) return 'Answer already delivered. No further tools may execute.';
  if (state.recovery && !isAnswerTool(toolName)) return 'Only submit_answer is allowed during answer recovery.';
  if (isAnswerTool(toolName) && (!state.runId || state.batchSize !== 1)) return 'Call submit_answer alone, after all other tools have finished.';
  return undefined;
}
