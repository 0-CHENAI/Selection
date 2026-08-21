/**
 * SDK Bridge - Environment variable building for Pi Agent Event automations
 *
 * Maps Agent Event fields to CRAFT_* environment variables for prompt and webhook actions.
 */

import { sanitizeForShell } from './security.ts';
import { cleanEnv } from './utils.ts';
import type { AgentEvent, SdkAutomationInput } from './types.ts';

function applySharedEnvelope(env: Record<string, string>, input: SdkAutomationInput): void {
  if (input.source_session_id) env.CRAFT_SOURCE_SESSION_ID = input.source_session_id;
  if (input.source_session_name) env.CRAFT_SOURCE_SESSION_NAME = sanitizeForShell(input.source_session_name);
  if (input.source_backend) env.CRAFT_SOURCE_BACKEND = input.source_backend;
  if (input.event_id) env.CRAFT_EVENT_ID = input.event_id;
  if (input.workspace_id) env.CRAFT_WORKSPACE_ID = input.workspace_id;
  env.CRAFT_AUTOMATION_DEPTH = String(input.automation_depth ?? 0);
}

function applySdkEventFields(env: Record<string, string>, event: AgentEvent, input: SdkAutomationInput): void {
  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PermissionRequest':
      if (input.tool_name) env.CRAFT_TOOL_NAME = input.tool_name;
      if (input.tool_input) env.CRAFT_TOOL_INPUT = sanitizeForShell(JSON.stringify(input.tool_input));
      if (input.tool_response) env.CRAFT_TOOL_RESPONSE = sanitizeForShell(input.tool_response);
      break;

    case 'PostToolUseFailure':
      if (input.tool_name) env.CRAFT_TOOL_NAME = input.tool_name;
      if (input.tool_input) env.CRAFT_TOOL_INPUT = sanitizeForShell(JSON.stringify(input.tool_input));
      if (input.error) env.CRAFT_ERROR = sanitizeForShell(input.error);
      break;

    case 'UserPromptSubmit':
      if (input.prompt) env.CRAFT_PROMPT = sanitizeForShell(input.prompt);
      break;

    case 'SessionStart':
      if (input.source) env.CRAFT_SOURCE = input.source;
      if (input.model) env.CRAFT_MODEL = input.model;
      break;

    case 'SubagentStart':
    case 'SubagentStop':
      if (input.agent_id) env.CRAFT_AGENT_ID = input.agent_id;
      if (input.agent_type) env.CRAFT_AGENT_TYPE = input.agent_type;
      break;

    case 'PreCompact':
      if (input.compact_trigger) env.CRAFT_COMPACT_TRIGGER = input.compact_trigger;
      break;

    case 'Stop':
      if (input.stop_reason) env.CRAFT_STOP_REASON = input.stop_reason;
      break;

    default:
      break;
  }
}

/**
 * Build environment variables from SDK automation input.
 * Maps SDK input fields to CRAFT_* environment variables.
 */
export function buildEnvFromSdkInput(event: AgentEvent, input: SdkAutomationInput): Record<string, string> {
  const env: Record<string, string> = {
    ...cleanEnv(),
    CRAFT_EVENT: event,
  };
  applySharedEnvelope(env, input);
  applySdkEventFields(env, event, input);
  return env;
}

/**
 * Webhook-safe env for Agent Events: CRAFT_* from the event plus CRAFT_WH_* secrets.
 * Never spreads process.env.
 */
export function buildWebhookEnvFromSdkInput(event: AgentEvent, input: SdkAutomationInput): Record<string, string> {
  const env: Record<string, string> = { CRAFT_EVENT: event };
  applySharedEnvelope(env, input);
  applySdkEventFields(env, event, input);

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CRAFT_WH_') && value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}
