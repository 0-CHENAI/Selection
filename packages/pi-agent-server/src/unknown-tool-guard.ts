import { createAssistantMessageEventStream, type Context, type AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { classifyPreviewFenceToolName } from '../../shared/src/agent/core/tool-input-recovery';

/** Inspect only the current turn's trailing unknown-tool failures. Never retry or alias execution. */
export function unknownToolRecovery(context: Context): { context: Context; stop?: string } {
  const available = new Set((context.tools ?? []).map(tool => tool.name));
  const failures: string[] = [];
  for (let index = context.messages.length - 1; index >= 0; index--) {
    const message = context.messages[index]!;
    if (message.role === 'user') break;
    if (message.role !== 'toolResult') continue;
    const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    if (!message.isError || available.has(message.toolName) || !/tool[\s\S]*not found|unknown tool/i.test(text)) break;
    failures.push(message.toolName);
  }
  const latest = failures[0];
  if (!latest) return { context };
  const repeated = failures.filter(name => name === latest).length;
  if (repeated >= 3 || failures.length >= 6) return { context, stop: `工具 ${latest} 不存在，本轮已连续出现 ${failures.length} 次无效工具调用，已停止重复调用。请使用当前注册的工具继续。` };
  const preview = classifyPreviewFenceToolName(latest)
    ? `${latest} is a Markdown fenced-code rendering format, NOT a callable tool. To inspect an image, use the registered read tool if available. To display it, emit the preview fence in assistant text after the file exists. Do not claim the image was inspected merely by displaying it.`
    : 'Do not retry this unavailable name or invent aliases. Choose a registered tool that can perform the task, or explain the capability limitation.';
  return { context: { ...context, systemPrompt: `${context.systemPrompt ?? ''}\n\nTool-call correction: ${latest} is unavailable. ${preview}\nCurrently registered tools: ${[...available].join(', ') || '(none)'}.` } };
}

export function installUnknownToolGuard(session: AgentSession): void {
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = (model, context, options) => {
    const recovery = unknownToolRecovery(context);
    if (!recovery.stop) return stream(model, recovery.context, options);
    const result = createAssistantMessageEventStream();
    const error: AssistantMessage = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'error', errorMessage: recovery.stop, timestamp: Date.now(),
    };
    result.push({ type: 'error', reason: 'error', error });
    result.end(error);
    return result;
  };
}
