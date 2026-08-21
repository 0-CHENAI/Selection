/**
 * Single builder for Agent Event payloads so every Pi production site
 * carries the same envelope (ids, source session, recursion markers).
 */

import { randomUUID } from 'node:crypto';
import type { AgentEvent, SdkAutomationInput } from './types.ts';
import { sanitizeAgentEventInput } from './agent-event-sanitize.ts';

export interface AgentEventSourceContext {
  workspaceId: string;
  sessionId?: string;
  sessionName?: string;
  triggeredByAutomation?: boolean;
  automationDepth?: number;
}

export function enrichAgentEventInput(
  event: AgentEvent,
  input: SdkAutomationInput,
  source: AgentEventSourceContext,
): SdkAutomationInput {
  const depth = source.automationDepth ?? 0;
  const triggered = source.triggeredByAutomation === true || depth > 0;

  return sanitizeAgentEventInput({
    ...input,
    hook_event_name: input.hook_event_name || event,
    event_id: input.event_id ?? randomUUID(),
    workspace_id: input.workspace_id ?? source.workspaceId,
    source_session_id: input.source_session_id ?? source.sessionId,
    source_session_name: input.source_session_name ?? source.sessionName,
    source_backend: 'pi',
    automation_depth: input.automation_depth ?? depth,
    triggered_by_automation: input.triggered_by_automation ?? triggered,
  });
}
