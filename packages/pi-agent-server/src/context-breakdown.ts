import { modelVisibleTools } from '../../shared/src/agent/backend/pi/model-visible-tools.ts';
import { convertToLlm, type AgentSession } from '@earendil-works/pi-coding-agent';
import { getCurrentTools, type Context } from '@earendil-works/pi-ai';
import {
  contextBreakdownTotal,
  estimateContextInputBreakdown,
  type ContextInputBreakdown,
} from '../../shared/src/agent/backend/pi/context-budget.ts';

function asContext(session: AgentSession): Context | undefined {
  const state = session.agent.state as {
    systemPrompt?: string;
    tools?: Context['tools'];
    messages?: Parameters<typeof convertToLlm>[0];
  };
  const messages = convertToLlm(state.messages ?? []);
  const prompt = session.systemPrompt ?? state.systemPrompt;
  const declaredTools = getCurrentTools(messages);
  const tools = declaredTools.length > 0 ? declaredTools : state.tools;
  if (!prompt && !tools?.length && !messages.length) return undefined;
  return {
    systemPrompt: prompt,
    tools: tools ? modelVisibleTools(tools) : undefined,
    // The current Pi prompt is projected onto the request and may differ from
    // older system messages kept in the saved transcript.
    messages: messages.filter(message => message.role !== 'system'),
  };
}

function isEmptyBreakdown(breakdown: ContextInputBreakdown): boolean {
  return contextBreakdownTotal(breakdown) <= 0;
}

/** Estimate the live Pi context split for the context-usage popover. */
export function snapshotContextBreakdown(session: AgentSession | null): ContextInputBreakdown | undefined {
  if (!session) return undefined;
  const context = asContext(session);
  if (!context) return undefined;
  const breakdown = estimateContextInputBreakdown(context);
  return isEmptyBreakdown(breakdown) ? undefined : breakdown;
}
