import type {
  AssistantMessage,
  Context,
  Message,
  Tool,
} from '@earendil-works/pi-ai';
import { estimateTokensDensityAware } from '../../../utils/token-estimate.ts';

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

/** Estimated request composition. Optional fields are omitted when Selection has no matching content. */
export interface ContextInputBreakdown {
  systemPrompt: number;
  tools: number;
  messages: number;
  rules?: number;
  skills?: number;
  mcpTools?: number;
  subagents?: number;
  summarized?: number;
}

export const OPTIONAL_CONTEXT_BREAKDOWN_KEYS = [
  'rules',
  'skills',
  'mcpTools',
  'subagents',
  'summarized',
] as const;

export type OptionalContextBreakdownKey = (typeof OPTIONAL_CONTEXT_BREAKDOWN_KEYS)[number];

const RULE_TAGS = ['project_context', 'project_context_files'] as const;
const SKILL_TAGS = ['available_skills'] as const;
const SOURCE_TAGS = ['sources'] as const;
const SUMMARY_TAGS = ['session_transfer_summary', 'conversation_recovery'] as const;

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
 * Shared estimator counts CJK separately and corrects dense base64 in prompts,
 * tool schemas and messages. Tool-result spill uses the same estimate.
 */
export function estimateTextTokensConservatively(text: string): number {
  return estimateTokensDensityAware(text);
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

/** Preserve offsets while ignoring fenced examples when locating envelope tags. */
function maskFencedExamples(text: string): string {
  let fence: { char: string; length: number } | undefined;
  return text.split(/(?<=\n)/).map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
    const inside = !!fence;
    if (marker) {
      if (!fence) fence = { char: marker[1]![0]!, length: marker[1]!.length };
      else if (marker[1]![0] === fence.char && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined;
    }
    return inside || !!fence ? line.replace(/[^\r\n]/g, ' ') : line;
  }).join('');
}

function takeTaggedBlocks(text: string, tags: readonly string[]): { extracted: string; rest: string } {
  let extracted = '';
  let rest = text;
  for (const tag of tags) {
    // Only standalone envelopes count, never a tag mentioned in prose/code.
    const re = new RegExp(`^[ \\t]*<${tag}(?:[ \\t][^>\\r\\n]*)?>[\\s\\S]*?<\\/${tag}>[ \\t]*(?=\\r?$)`, 'gim');
    const matches = [...maskFencedExamples(rest).matchAll(re)];
    for (const match of matches.reverse()) {
      const start = match.index!;
      const end = start + match[0].length;
      const block = rest.slice(start, end);
      extracted += extracted ? `\n${block}` : block;
      rest = rest.slice(0, start) + rest.slice(end);
    }
  }
  return { extracted, rest };
}

function takePreferences(text: string): { extracted: string; rest: string } {
  const re = /^## User Preferences[^\r\n]*[\s\S]*?(?=^## |^<[A-Za-z/]|$(?![\s\S]))/m;
  const match = maskFencedExamples(text).match(re);
  if (!match) return { extracted: '', rest: text };
  const start = match.index!;
  const end = start + match[0].length;
  return { extracted: text.slice(start, end), rest: text.slice(0, start) + text.slice(end) };
}

function splitPromptText(text: string): {
  rest: string;
  rules: string;
  skills: string;
  mcp: string;
  summarized: string;
} {
  const skills = takeTaggedBlocks(text, SKILL_TAGS);
  const rulesTagged = takeTaggedBlocks(skills.rest, RULE_TAGS);
  const prefs = takePreferences(rulesTagged.rest);
  const sources = takeTaggedBlocks(prefs.rest, SOURCE_TAGS);
  const summarized = takeTaggedBlocks(sources.rest, SUMMARY_TAGS);
  return {
    rest: summarized.rest,
    rules: [rulesTagged.extracted, prefs.extracted].filter(Boolean).join('\n'),
    skills: skills.extracted,
    mcp: sources.extracted,
    summarized: summarized.extracted,
  };
}

function addOptional(
  breakdown: ContextInputBreakdown,
  key: OptionalContextBreakdownKey,
  tokens: number,
): void {
  if (tokens <= 0) return;
  breakdown[key] = (breakdown[key] ?? 0) + tokens;
}

function classifyToolName(name: string): OptionalContextBreakdownKey | 'tools' {
  const lower = name.toLowerCase();
  const bare = lower.replace(/^mcp__session__/, '').replace(/^session__/, '');
  if (bare === 'spawn_session' || bare === 'wait_for_session') return 'subagents';
  if (lower.startsWith('mcp__source__')) return 'mcpTools';
  if (lower.startsWith('mcp__') && !lower.startsWith('mcp__session__')) return 'mcpTools';
  return 'tools';
}

function estimatePromptCategories(text: string, breakdown: ContextInputBreakdown, into: 'system' | 'message'): void {
  const parts = splitPromptText(text);
  addOptional(breakdown, 'rules', estimateTextTokensConservatively(parts.rules));
  addOptional(breakdown, 'skills', estimateTextTokensConservatively(parts.skills));
  addOptional(breakdown, 'mcpTools', estimateTextTokensConservatively(parts.mcp));
  addOptional(breakdown, 'summarized', estimateTextTokensConservatively(parts.summarized));
  const rest = estimateTextTokensConservatively(parts.rest);
  if (into === 'system') breakdown.systemPrompt += rest;
  else breakdown.messages += rest;
}

function estimateStructuredContent(content: Exclude<Message['content'], string>, breakdown: ContextInputBreakdown): void {
  for (const block of content) {
    if (block.type === 'image') breakdown.messages += IMAGE_RESERVE_TOKENS;
    else if (block.type === 'text') estimatePromptCategories(block.text, breakdown, 'message');
    else if (block.type === 'thinking') {
      breakdown.messages += estimateTextTokensConservatively(block.thinking);
    } else {
      breakdown.messages += estimateTextTokensConservatively(block.name);
      breakdown.messages += estimateTextTokensConservatively(safeJson(block.arguments));
    }
  }
}

export function contextBreakdownTotal(breakdown: ContextInputBreakdown): number {
  return Math.max(0, breakdown.systemPrompt)
    + Math.max(0, breakdown.tools)
    + Math.max(0, breakdown.messages)
    + OPTIONAL_CONTEXT_BREAKDOWN_KEYS.reduce(
      (sum, key) => sum + Math.max(0, breakdown[key] ?? 0),
      0,
    );
}

export function readContextBreakdownFields(raw: unknown): ContextInputBreakdown | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const systemPrompt = record.systemPrompt;
  const tools = record.tools;
  const messages = record.messages;
  if (
    typeof systemPrompt !== 'number' || !Number.isFinite(systemPrompt) ||
    typeof tools !== 'number' || !Number.isFinite(tools) ||
    typeof messages !== 'number' || !Number.isFinite(messages)
  ) {
    return undefined;
  }
  const breakdown: ContextInputBreakdown = {
    systemPrompt: Math.max(0, Math.floor(systemPrompt)),
    tools: Math.max(0, Math.floor(tools)),
    messages: Math.max(0, Math.floor(messages)),
  };
  for (const key of OPTIONAL_CONTEXT_BREAKDOWN_KEYS) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      breakdown[key] = Math.max(0, Math.floor(value));
    }
  }
  return breakdown;
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

export function estimateContextInputBreakdown(context: Context): ContextInputBreakdown {
  const breakdown: ContextInputBreakdown = {
    systemPrompt: 0,
    tools: 0,
    messages: 0,
  };

  estimatePromptCategories(context.systemPrompt ?? '', breakdown, 'system');

  for (const tool of context.tools ?? []) {
    const tokens = estimateTextTokensConservatively(safeJson(tool));
    const bucket = classifyToolName(typeof tool.name === 'string' ? tool.name : '');
    if (bucket === 'tools') breakdown.tools += tokens;
    else addOptional(breakdown, bucket, tokens);
  }

  for (const message of context.messages) {
    // Tool output is data, not a trusted context envelope. Skill bodies read
    // through tools remain here; the skills bucket measures the catalog only.
    if (message.role === 'toolResult' || message.role === 'assistant') {
      breakdown.messages += estimateMessage(message);
      continue;
    }
    breakdown.messages += MESSAGE_OVERHEAD_TOKENS;
    if (typeof message.content === 'string') {
      estimatePromptCategories(message.content, breakdown, 'message');
    } else {
      estimateStructuredContent(message.content, breakdown);
    }
  }

  return breakdown;
}

/** Estimate the complete request, including system prompt, tool schemas and images. */
export function estimateContextInputTokens(context: Context): number {
  const fullEstimate = contextBreakdownTotal(estimateContextInputBreakdown(context));

  // Provider usage is the best signal for an already-sent prefix. The full
  // estimate protects new sessions and changed system/tool payloads. Taking
  // the maximum avoids double-counting either representation.
  return Math.max(fullEstimate, estimateFromLatestUsage(context));
}

export function calculateContextReserve(estimatedInputTokens: number, contextWindow?: number): number {
  const reserve = Math.max(
    MIN_CONTEXT_RESERVE_TOKENS,
    Math.ceil(Math.max(0, estimatedInputTokens) * CONTEXT_RESERVE_RATIO),
  );
  // The 8k floor would leave a small-window model with no reply budget at all.
  return typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0
    ? Math.min(reserve, Math.max(256, Math.floor(contextWindow * 0.1)))
    : reserve;
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

  const reserveTokens = calculateContextReserve(estimatedInput, contextWindow);
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
