import { describe, expect, it } from 'bun:test';
import {
  normalizeProxyToolExecutionEnd,
  proxyToolDetails,
} from './proxy-tool-protocol.ts';

describe('proxy tool JSONL protocol', () => {
  it('preserves a proxy failure on the forwarded event and session completion', () => {
    const proxyResult = { isError: true };
    const sdkEvent = {
      type: 'tool_execution_end' as const,
      toolCallId: 'call-skill-validate',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'QA failed' }],
        details: proxyToolDetails(proxyResult),
      },
    };

    const normalized = normalizeProxyToolExecutionEnd(sdkEvent, {
      toolName: 'skill_validate',
      arguments: { slug: 'example' },
    });

    expect(normalized.forwardedEvent.isError).toBe(true);
    expect(normalized.sessionToolCompleted).toEqual({
      type: 'session_tool_completed',
      toolName: 'skill_validate',
      args: { slug: 'example' },
      isError: true,
    });
    expect(sdkEvent.isError).toBe(false);
  });
});
