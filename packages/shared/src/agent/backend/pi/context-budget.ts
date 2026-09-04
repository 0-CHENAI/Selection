import type {
  AssistantMessage,
  Context,
  Message,
  Tool,
} from '@earendil-works/pi-ai';

/** Keep enough headroom for provider-side tokenization and request framing. */
export const MIN_CONTEXT_RESERVE_TOKENS = 8_192;
const CONTEXT_RESERVE_RATIO = 0.02;
const IMAGE_RESERVE_TOKENS = 2_048;
const MESSAGE_OVERHEAD_TOKENS = 8;
const MIN_RETRY_OUTPUT_TOKENS = 256;

export const ACTIONABLE_CONTEXT_OVERFLOW_MESSAGE =
  '当前会话已超出模型可用上下文。系统已尝试缩减输出预算并压缩上下文，但仍无法继续。请使用 /compact 后重试，减少附件或较大的工具结果，或新建会话并选择更大上下文的模型。';

export interface ContextBudget {
  estimatedInputTokens: number;
  reserveTokens: number;
  maxOutputTokens: number;
  wasReduced: boolean;
}

export interface ParsedContextOverflow {
  contextWindow?: number;
  inputTokens?: number;
  requestedOutputTokens?: number;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    // A circular/unserializable schema is unusual but must not disable the
    // guard. The reserve still protects the request in this fallback case.
    return '[unserializable]';
  }
}

/**
 * Conservative mixed-language estimator. ASCII prose/code averages about four
 * characters per token; CJK and other non-ASCII characters can approach one
 * token each, so counting them separately avoids the SDK's CJK under-estimate.
 */
export function estimateTextTokensConservatively(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

function estimateContent(content: Message['content']): number {
  if (typeof content === 'string') return estimateTextTokensConservatively(content);

  let tokens = 0;
  for (const block of content) {
    if (block.type === 'image') tokens += IMAGE_RESERVE_TOKENS;
    else if (block.type === 'text') tokens += estimateTextTokensConservatively(block.text);
    else if (block.type === 'thinking') tokens += estimateTextTokensConservatively(block.thinking);
    else {
      tokens += estimateTextTokensConservatively(block.name);
      tokens += estimateTextTokensConservatively(safeJson(block.arguments));
    }
  }
  return tokens;
}

function estimateMessage(message: Message): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateContent(message.content);
}

function usageTokens(message: AssistantMessage): number {
  const usage = message.usage;
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function estimateTools(tools: Tool[] | undefined): number {
  if (!tools?.length) return 0;
  return estimateTextTokensConservatively(safeJson(tools));
}

function estimateFromLatestUsage(context: Context): number {
  let lastUsageIndex = -1;
  let latestUsage = 0;
  let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < context.messages.length; index += 1) {
    const message = context.messages[index];
    if (!message) continue;
    if (message.role === 'assistant') {
      const tokens = usageTokens(message);
      if (
        message.timestamp >= latestPrefixTimestamp &&
        message.stopReason !== 'aborted' &&
        message.stopReason !== 'error' &&
        tokens > 0
      ) {
        lastUsageIndex = index;
        latestUsage = tokens;
      }
    }
    latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
  }

  if (lastUsageIndex < 0) return 0;

  let trailing = 0;
  const addedToolNames = new Set<string>();
  for (const message of context.messages.slice(lastUsageIndex + 1)) {
    trailing += estimateMessage(message);
    if (message.role === 'toolResult') {
      for (const name of message.addedToolNames ?? []) addedToolNames.add(name);
    }
  }
  const addedTools = context.tools?.filter(tool => addedToolNames.has(tool.name));
  return latestUsage + trailing + estimateTools(addedTools);
}

/** Estimate the complete request, including system prompt, tool schemas and images. */
export function estimateContextInputTokens(context: Context): number {
  const fullEstimate =
    estimateTextTokensConservatively(context.systemPrompt ?? '') +
    estimateTools(context.tools) +
    context.messages.reduce((total, message) => total + estimateMessage(message), 0);

  // Provider usage is the best signal for an already-sent prefix. The full
  // estimate protects new sessions and changed system/tool payloads. Taking
  // the maximum avoids double-counting either representation.
  return Math.max(fullEstimate, estimateFromLatestUsage(context));
}

export function calculateContextReserve(estimatedInputTokens: number): number {
  return Math.max(
    MIN_CONTEXT_RESERVE_TOKENS,
    Math.ceil(Math.max(0, estimatedInputTokens) * CONTEXT_RESERVE_RATIO),
  );
}

export function calculateContextBudget(
  contextWindow: number,
  requestedOutputTokens: number,
  estimatedInputTokens: number,
): ContextBudget {
  const requested = Number.isFinite(requestedOutputTokens)
    ? Math.max(1, Math.floor(requestedOutputTokens))
    : 1;
  const estimatedInput = Number.isFinite(estimatedInputTokens)
    ? Math.max(0, Math.floor(estimatedInputTokens))
    : 0;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return {
      estimatedInputTokens: estimatedInput,
      reserveTokens: 0,
      maxOutputTokens: requested,
      wasReduced: false,
    };
  }

  const reserveTokens = calculateContextReserve(estimatedInput);
  const available = Math.max(1, Math.floor(contextWindow) - estimatedInput - reserveTokens);
  const maxOutputTokens = Math.min(requested, available);
  return {
    estimatedInputTokens: estimatedInput,
    reserveTokens,
    maxOutputTokens,
    wasReduced: maxOutputTokens < requested,
  };
}

export function buildContextBudget(
  contextWindow: number,
  requestedOutputTokens: number,
  context: Context,
): ContextBudget {
  return calculateContextBudget(
    contextWindow,
    requestedOutputTokens,
    estimateContextInputTokens(context),
  );
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value.replaceAll(',', ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Parse common OpenAI-compatible overflow messages without provider coupling. */
export function parseContextOverflow(message: string): ParsedContextOverflow {
  const contextWindow = parseInteger(
    message.match(/maximum context length (?:is|of)\s*([\d,]+)/i)?.[1] ??
    message.match(/maximum_context_length\s*\(?\s*([\d,]+)/i)?.[1],
  );
  const inputTokens = parseInteger(
    message.match(/(?:prompt contains at least|prompt contains|messages resulted in)\s*([\d,]+)\s*(?:input\s*)?tokens/i)?.[1] ??
    message.match(/prompt_tokens\s*\(?\s*([\d,]+)/i)?.[1],
  );
  const requestedOutputTokens = parseInteger(
    message.match(/requested\s*([\d,]+)\s*output tokens/i)?.[1] ??
    message.match(/max_tokens\s*\(?\s*([\d,]+)/i)?.[1],
  );
  return { contextWindow, inputTokens, requestedOutputTokens };
}

/**
 * Compute a strictly lower one-shot retry cap from provider-reported counts.
 * Returns undefined when even a useful minimal response cannot fit, allowing
 * the SDK's bounded auto-compaction path to take over.
 */
export function calculateOverflowRetryMaxTokens(
  errorMessage: string,
  fallbackContextWindow: number,
  currentMaxTokens: number,
): number | undefined {
  const current = Math.max(1, Math.floor(currentMaxTokens));
  const parsed = parseContextOverflow(errorMessage);
  const contextWindow = parsed.contextWindow ?? fallbackContextWindow;

  let candidate: number;
  if (contextWindow > 0 && parsed.inputTokens) {
    const reserve = calculateContextReserve(parsed.inputTokens);
    candidate = contextWindow - parsed.inputTokens - reserve;
  } else {
    candidate = Math.floor(current * 0.75);
  }

  candidate = Math.min(current - 1, Math.floor(candidate));
  return candidate >= MIN_RETRY_OUTPUT_TOKENS ? candidate : undefined;
}
