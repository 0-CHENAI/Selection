export interface ProxyToolTelemetry {
  errorType?: string;
  failedIndex?: number;
  qaMode?: string;
  visualStatus?: string;
}

export interface ProxyToolOutcome {
  isError: boolean;
  telemetry?: ProxyToolTelemetry;
}

export interface PendingSessionToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionEndLike {
  type: 'tool_execution_end';
  toolCallId: string;
  isError?: boolean;
  result?: unknown;
}

export interface SessionToolCompleted {
  type: 'session_tool_completed';
  toolName: string;
  args: Record<string, unknown>;
  isError: boolean;
}

export function proxyToolDetails(result: ProxyToolOutcome): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};
  if (result.isError) details.isError = true;
  if (result.telemetry) details.selectionTelemetry = result.telemetry;
  return Object.keys(details).length > 0 ? details : undefined;
}

/**
 * Preserve proxy-tool failures when Pi reports the outer SDK event as successful.
 * Pi carries proxy status in `result.details`, while Selection's JSONL protocol
 * expects the error bit on both the forwarded event and completion notification.
 */
export function normalizeProxyToolExecutionEnd<T extends ToolExecutionEndLike>(
  event: T,
  pending?: PendingSessionToolCall,
): { forwardedEvent: T; sessionToolCompleted?: SessionToolCompleted } {
  const resultDetails = event.result && typeof event.result === 'object'
    ? (event.result as { details?: { isError?: unknown } }).details
    : undefined;
  const effectiveIsError = event.isError === true || resultDetails?.isError === true;
  const forwardedEvent = effectiveIsError && event.isError !== true
    ? { ...event, isError: true }
    : event;

  return {
    forwardedEvent,
    ...(pending ? {
      sessionToolCompleted: {
        type: 'session_tool_completed' as const,
        toolName: pending.toolName,
        args: pending.arguments,
        isError: effectiveIsError,
      },
    } : {}),
  };
}
