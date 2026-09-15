const terminalCodes = new Set<string>([
  'model_request_timeout', 'answer_delivery_missing', 'answer_persistence_failed', 'progress_needs_user', 'output_limit', 'call_time_limit', 'provider_timeout', 'no_response', 'tool_only_response', 'context_limit', 'stream_interrupted', 'agent_process_exited',
])

/** Terminal failures require a follow-up against retained history, not prompt replay. */
export function isTerminalResponseError(code: string | undefined): boolean {
  return code !== undefined && terminalCodes.has(code)
}
