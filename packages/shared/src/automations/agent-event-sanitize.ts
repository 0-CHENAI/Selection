/**
 * Size limits and structured redaction for Agent Event payloads.
 * Prevents huge tool results and obvious secrets from reaching history or webhooks.
 */

import type { SdkAutomationInput } from './types.ts';

export const AGENT_EVENT_PAYLOAD_MAX_CHARS = 8_000;

const SENSITIVE_KEY = /authorization|cookie|set-cookie|token|password|secret|api[_-]?key|access[_-]?key|private[_-]?key|credential/i;

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > AGENT_EVENT_PAYLOAD_MAX_CHARS
      ? `${value.slice(0, AGENT_EVENT_PAYLOAD_MAX_CHARS)}…[truncated]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map(redactValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(nested);
    }
    return out;
  }
  return value;
}

function clipString(value: string | undefined): string | undefined {
  if (value == null) return value;
  return value.length > AGENT_EVENT_PAYLOAD_MAX_CHARS
    ? `${value.slice(0, AGENT_EVENT_PAYLOAD_MAX_CHARS)}…[truncated]`
    : value;
}

function sanitizePossiblyJsonString(value: string | undefined): string | undefined {
  if (value == null) return value;
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return clipString(JSON.stringify(redactValue(JSON.parse(trimmed))));
    } catch {
      // Fall through to plain clipping when the payload is not valid JSON.
    }
  }
  return clipString(value);
}

export function sanitizeAgentEventInput(input: SdkAutomationInput): SdkAutomationInput {
  const toolInput = input.tool_input
    ? redactValue(input.tool_input) as Record<string, unknown>
    : undefined;

  return {
    ...input,
    tool_input: toolInput,
    tool_response: sanitizePossiblyJsonString(input.tool_response),
    error: clipString(input.error),
    prompt: clipString(input.prompt),
    message: clipString(input.message),
  };
}
