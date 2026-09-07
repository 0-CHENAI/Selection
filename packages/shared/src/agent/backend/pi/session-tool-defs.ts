/**
 * Pi Session Tool Proxy Definitions
 *
 * Thin wrapper around the canonical tool definitions in @craft-agent/session-tools-core.
 * Session tools keep the `mcp__session__` namespace for MCP-style dispatch, plus
 * short-name aliases for names the system prompt uses without a prefix.
 */

import {
  getToolDefsAsJsonSchema,
  SESSION_TOOL_NAMES,
  type JsonSchemaToolDef,
} from '@craft-agent/session-tools-core';
import { FEATURE_FLAGS } from '../../../feature-flags.ts';

export type SessionToolProxyDef = JsonSchemaToolDef;

export { SESSION_TOOL_NAMES };

export const PI_SESSION_TOOL_PREFIX = 'mcp__session__';

/**
 * Prompt-facing orchestration names. The system prompt tells the model to call
 * these without an MCP prefix; Pi's registry lookup is exact-name.
 * Do not alias browser_tool — pi-agent filters only the prefixed name.
 */
export const PI_SESSION_TOOL_SHORT_NAME_ALIASES = [
  'spawn_session',
  'call_llm',
  'run_task',
] as const;

export function resolveSessionToolProxyName(toolName: string): string {
  if (toolName.startsWith(PI_SESSION_TOOL_PREFIX)) return toolName;

  const stripped = toolName.startsWith('session__')
    ? toolName.slice('session__'.length)
    : toolName;

  return SESSION_TOOL_NAMES.has(stripped) ? `${PI_SESSION_TOOL_PREFIX}${stripped}` : toolName;
}

export function getSessionToolProxyDefs(): SessionToolProxyDef[] {
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

  return aliases.length > 0 ? [...prefixed, ...aliases] : prefixed;
}
