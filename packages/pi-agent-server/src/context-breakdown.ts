import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Context } from '@earendil-works/pi-ai';
import {
  estimateContextInputBreakdown,
  type ContextInputBreakdown,
} from '../../shared/src/agent/backend/pi/context-budget.ts';

function asContext(session: AgentSession): Context | undefined {
  const state = session.agent.state as {
    systemPrompt?: string;
    tools?: Context['tools'];
    messages?: Context['messages'];
  };
  if (!state.messages && !state.systemPrompt && !state.tools) return undefined;
  return {
    systemPrompt: state.systemPrompt,
    tools: state.tools,
    messages: state.messages ?? [],
  };
}

/** Estimate the live Pi context split for the context-usage popover. */
export function snapshotContextBreakdown(session: AgentSession | null): ContextInputBreakdown | undefined {
  if (!session) return undefined;
  const context = asContext(session);
  if (!context) return undefined;
  return estimateContextInputBreakdown(context);
}
