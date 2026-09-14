import type { Context, Message, Tool } from '@earendil-works/pi-ai';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../shared/src/thought-workbench/context.ts';
import { assertImmutableContextFits } from './explicit-query-input.ts';
import type { AgentPromptInput } from '../../shared/src/agent/pi-turn-input.ts';
export type { AgentPromptInput } from '../../shared/src/agent/pi-turn-input.ts';

/** Provider credentials are never returned in the preview. Runtime configuration
 * participates only in the digest, so a model/endpoint change invalidates it.
 */
export function snapshotAgentInput(input: AgentPromptInput, runtime: {
  messages: Message[];
  tools: Tool[];
  model: { id: string; api: string; provider: string; contextWindow: number };
  configuration: unknown;
}) {
  const context: Context = {
    systemPrompt: input.systemPrompt,
    messages: [...runtime.messages, { role: 'user', timestamp: 0, content: [
      { type: 'text', text: input.message }, ...(input.images ?? []),
    ] }],
    tools: runtime.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  };
  // Serialize only model-facing fields, not executable tool callbacks.
  const captured = JSON.parse(JSON.stringify(context)) as Context;
  assertImmutableContextFits(captured, runtime.model.contextWindow);
  const model = { id: runtime.model.id, api: runtime.model.api, provider: runtime.model.provider, contextWindow: runtime.model.contextWindow };
  return { context: captured, model, hash: createHash('sha256').update(canonicalJson({ context: captured, model, configuration: runtime.configuration })).digest('hex') };
}
