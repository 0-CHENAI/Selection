export function isAnswerTool(name: string): boolean {
  return name === 'submit_answer' || name === 'mcp__session__submit_answer' || name === 'session__submit_answer';
}

/** A successful coordinator decision hands the current turn back to the host. */
export function isCoordinatorDecisionTool(name: string): boolean {
  return /^(?:mcp__session__|session__)?submit_orchestration_(?:decision|patch)$/.test(name);
}

export function isTurnCompletionTool(name: string): boolean {
  return isAnswerTool(name) || isCoordinatorDecisionTool(name);
}

/** A duplicate receipt must not abandon a newer gate whose notification started this turn. */
export function acceptsTurnCompletion(name: string, result: { isError?: boolean; content: string | { type: string; text?: string }[] }): boolean {
  if (!isTurnCompletionTool(name) || result.isError) return false;
  if (isCoordinatorDecisionTool(name)) {
    try {
      const receipt = JSON.parse(typeof result.content === 'string' ? result.content : result.content.find(block => block.type === 'text')?.text ?? '');
      if (receipt?.alreadyApplied === true && receipt.status === 'waiting-coordinator' && receipt.coordinatorGate?.checkpointId) return false;
    } catch { /* Older successful receipts keep their existing handoff behavior. */ }
  }
  return true;
}

/** Scope model-visible tools for this turn; the caller restores the full set next turn. */
export function answerTurnToolNames(names: string[], state: { runId?: string; recovery?: boolean; coordinationOnly?: boolean }): string[] {
  // natural-v1: recovery is a text-only step and no delivery tool is exposed.
  return state.recovery ? [] : names.filter(name => !isAnswerTool(name));
}

/** Guard the entire SDK tool batch, before any permission or execution request. */
export function answerExecutionError(state: {
  runId?: string
  accepted: boolean
  recovery: boolean
  batchSize: number
  siblingsSettled?: boolean
  answerCalls?: number
}, toolName: string): string | undefined {
  if (state.accepted) return 'Answer already delivered. No further tools may execute.';
  if (state.recovery) return 'Tools are unavailable during answer recovery. Write the final answer as plain text.';
  if (isAnswerTool(toolName)) return 'There is no answer submission tool. Write the final answer as plain text.';
  if (isCoordinatorDecisionTool(toolName) && state.batchSize !== 1) return 'Call the coordinator decision alone, after all other tools have finished.';
  return undefined;
}
