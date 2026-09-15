import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Context } from '@earendil-works/pi-ai';
import {
  contextBreakdownTotal,
  estimateContextInputBreakdown,
  type ContextInputBreakdown,
} from '../../shared/src/agent/backend/pi/context-budget.ts';

function asContext(session: AgentSession): Context | undefined {
  const state = session.agent.state as {
    systemPrompt?: string;
    tools?: Context['tools'];
    messages?: Context['messages'];
  };
  if (!state.systemPrompt && !state.tools?.length && !state.messages?.length) return undefined;
  return {
    systemPrompt: state.systemPrompt,
    tools: state.tools,
    messages: state.messages ?? [],
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
