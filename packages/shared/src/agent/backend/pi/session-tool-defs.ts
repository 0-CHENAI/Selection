/**
 * Pi Session Tool Proxy Definitions
 *
 * Thin wrapper around the canonical tool definitions in @craft-agent/session-tools-core.
 * Session tools keep the `mcp__session__` namespace for MCP-style dispatch, plus
 * legacy short-name aliases for exact-name execution of existing calls.
 * Model requests advertise only the canonical name when both are registered.
 */

import {
  getToolDefsAsJsonSchema,
  SESSION_TOOL_NAMES,
  type JsonSchemaToolDef,
} from '@craft-agent/session-tools-core';
import { FEATURE_FLAGS } from '../../../feature-flags.ts';
import { PI_SESSION_TOOL_SHORT_NAME_ALIASES } from './model-visible-tools.ts';
import { complexToolCapability, complexCapabilityError, type WorkModeSession } from '../../../sessions/work-mode.ts';
import { taskListAllowed } from '@craft-agent/session-tools-core';

export type SessionToolProxyDef = JsonSchemaToolDef;

export { SESSION_TOOL_NAMES };

export const PI_SESSION_TOOL_PREFIX = 'mcp__session__';

export { PI_SESSION_TOOL_SHORT_NAME_ALIASES } from './model-visible-tools.ts';

export function resolveSessionToolProxyName(toolName: string): string {
  if (toolName.startsWith(PI_SESSION_TOOL_PREFIX)) return toolName;

  const stripped = toolName.startsWith('session__')
    ? toolName.slice('session__'.length)
    : toolName;

  return SESSION_TOOL_NAMES.has(stripped) ? `${PI_SESSION_TOOL_PREFIX}${stripped}` : toolName;
}

export function getSessionToolProxyDefs(options?: { executionSession?: WorkModeSession }): SessionToolProxyDef[] {
  const prefixed = getToolDefsAsJsonSchema({
    prefix: PI_SESSION_TOOL_PREFIX,
    includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
  });
  const byName = new Map(prefixed.map(def => [def.name, def]));
  const aliases: SessionToolProxyDef[] = [];

  for (const shortName of PI_SESSION_TOOL_SHORT_NAME_ALIASES) {
    if (byName.has(shortName)) continue;
    const source = byName.get(`${PI_SESSION_TOOL_PREFIX}${shortName}`);
    if (source) aliases.push({ ...source, name: shortName });
  }

  const defs = aliases.length > 0 ? [...prefixed, ...aliases] : prefixed;
  if (!options) return defs;
  return defs.filter(def => {
    const name = def.name.replace(/^mcp__session__/, '');
    if (['submit_task_output', 'submit_task_node_verdict', 'task_help'].includes(name)
      && !(options.executionSession?.taskRunId && options.executionSession.taskNodeId)) return false;
    const capability = complexToolCapability(def.name);
    if (capability && (!FEATURE_FLAGS.tasksOrchestrate || complexCapabilityError(options.executionSession, capability))) return false;
    return !def.name.endsWith('update_task_list') || (!!options.executionSession && taskListAllowed(options.executionSession));
  });
}
