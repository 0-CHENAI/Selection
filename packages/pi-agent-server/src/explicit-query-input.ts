import type { AssistantMessage, Context, Message } from '@earendil-works/pi-ai';
import type { LLMQueryRequest } from '../../shared/src/agent/llm-tool.ts';
import { estimateContextInputTokens } from '../../shared/src/agent/backend/pi/context-budget.ts';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../shared/src/thought-workbench/context.ts';

/** The query preflight and window check share exactly the same tool-free input. */
export function snapshotExplicitQuery(request: LLMQueryRequest, model: Pick<AssistantMessage, 'api' | 'provider' | 'model'> & { contextWindow: number }, configuration: unknown) {
  const context = explicitQueryContext(request, model);
  assertImmutableContextFits(context, model.contextWindow);
  const publicModel = { id: model.model, api: model.api, provider: model.provider, contextWindow: model.contextWindow };
  return { context, model: publicModel, hash: createHash('sha256').update(canonicalJson({
    context, model: publicModel, configuration,
    maxTokens: request.maxTokens, temperature: request.temperature, outputSchema: request.outputSchema,
  })).digest('hex') };
}

function explicitQueryContext(request: LLMQueryRequest, model: Pick<AssistantMessage, 'api' | 'provider' | 'model'>): Context {
  return JSON.parse(JSON.stringify({
    systemPrompt: request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.',
    messages: [...explicitQueryHistory(request, model), {
      role: 'user', timestamp: 0, content: [
        { type: 'text', text: request.prompt },
        ...(request.images ?? []).map(image => ({ type: 'image' as const, ...image })),
      ],
    }], tools: [],
  })) as Context;
}

/** Reject an oversized immutable snapshot; never compact or prune previewed input.
 * This is an estimate, not a provider tokenizer or a guarantee of acceptance.
 */
export function assertExplicitQueryFits(request: LLMQueryRequest, model: Pick<AssistantMessage, 'api' | 'provider' | 'model'> & { contextWindow: number }): void {
  if (!Number.isFinite(model.contextWindow) || model.contextWindow <= 0) throw new Error('The selected model has no known context window; configure it before exact-input generation');
  assertImmutableContextFits(explicitQueryContext(request, model), model.contextWindow);
}

/** Includes registered tool schemas and existing history, not just the graph text. */
export function assertImmutableContextFits(context: Context, contextWindow: number): void {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) throw new Error('The selected model has no known context window; configure it before exact-input generation');
  const estimated = estimateContextInputTokens(context);
  const reserve = Math.min(8192, Math.max(256, Math.ceil(contextWindow * 0.02)));
  if (estimated + reserve >= contextWindow) throw new Error(`The previewed context is estimated at ${estimated} tokens and does not fit the selected model's ${contextWindow}-token window with response headroom. Reduce the selected context or choose a larger-context model; no previewed content was removed.`);
}

/** Synthetic graph history has no external tool calls and no invented usage. */
export function explicitQueryHistory(request: LLMQueryRequest, model: Pick<AssistantMessage, 'api' | 'provider' | 'model'>): Message[] {
  return (request.messages ?? []).map((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant') throw new Error('Unsupported explicit history role');
    if (typeof message.content !== 'string') throw new Error('Invalid explicit history content');
    if (message.role === 'user') return { role: 'user', content: message.content, timestamp: index };
    return { role: 'assistant', content: [{ type: 'text', text: message.content }], ...model, timestamp: index,
      stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  });
}
