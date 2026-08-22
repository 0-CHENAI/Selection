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
      toolCallId: 'call-officecli-qa',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'QA failed' }],
        details: proxyToolDetails(proxyResult),
      },
    };

    const normalized = normalizeProxyToolExecutionEnd(sdkEvent, {
      toolName: 'officecli_qa',
      arguments: { file: 'report.docx', mode: 'balanced' },
    });

    expect(normalized.forwardedEvent.isError).toBe(true);
    expect(normalized.sessionToolCompleted).toEqual({
      type: 'session_tool_completed',
      toolName: 'officecli_qa',
      args: { file: 'report.docx', mode: 'balanced' },
      isError: true,
    });
    expect(sdkEvent.isError).toBe(false);
  });
});
