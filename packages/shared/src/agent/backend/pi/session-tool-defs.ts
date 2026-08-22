/**
 * Pi Session Tool Proxy Definitions
 *
 * Thin wrapper around the canonical tool definitions in @craft-agent/session-tools-core.
 * Session tools keep the `mcp__session__` namespace.
 */

import {
  getToolDefsAsJsonSchema,
  SESSION_TOOL_NAMES,
  type JsonSchemaToolDef,
} from '@craft-agent/session-tools-core';
import { FEATURE_FLAGS } from '../../../feature-flags.ts';

export type SessionToolProxyDef = JsonSchemaToolDef;

export { SESSION_TOOL_NAMES };

const PI_SESSION_TOOL_PREFIX = 'mcp__session__';

export function getSessionToolProxyDefs(): SessionToolProxyDef[] {
  return getToolDefsAsJsonSchema({
    prefix: PI_SESSION_TOOL_PREFIX,
    includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
  });
}
