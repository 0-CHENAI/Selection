import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { handleLargeResponse, tokenLimitFor } from '../../shared/src/utils/large-response.ts';
import { mergeSummarizedToolResult } from './tool-result-images.ts';

/** Bash uses a deterministic preview so process completion never waits for another model. */
export async function compactToolResult<T>(result: AgentToolResult<T>, options: {
  toolName: string;
  sessionPath: string;
  input: Record<string, unknown>;
  intent?: string;
  userRequest?: string;
  contextWindow?: number;
  summarize?: (prompt: string) => Promise<string | null>;
}): Promise<AgentToolResult<T>> {
  const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('');
  const compacted = await handleLargeResponse({
    text, sessionPath: options.sessionPath,
    context: { toolName: options.toolName, input: options.input, intent: options.intent, userRequest: options.userRequest },
    tokenLimit: options.toolName === 'Bash' ? Math.min(4000, tokenLimitFor(options.contextWindow)) : undefined,
    contextWindow: options.contextWindow,
    summarize: options.toolName === 'Bash' ? undefined : options.summarize,
  });
  if (!compacted) return result;
  // A preview/summary is not the original read range covered by this proof.
  // Keep execution receipts, but require a bounded reread for source verification.
  const details = result.details && typeof result.details === 'object' && 'sourceRead' in result.details
    ? { ...result.details, sourceRead: undefined } : result.details;
  // Keep isError, structuredContent (including exit code), receipts and images.
  return { ...result, details, content: mergeSummarizedToolResult(compacted.message, result.content) };
}
