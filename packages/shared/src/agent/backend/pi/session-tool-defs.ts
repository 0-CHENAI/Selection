/**
 * Pi Session Tool Proxy Definitions
 *
 * Thin wrapper around the canonical tool definitions in @craft-agent/session-tools-core.
 * Most session tools keep the `mcp__session__` namespace. Native Office tools
 * use their canonical public names so the registered schema and shared prompt
 * cannot drift.
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

export const PI_OFFICE_DOCUMENT_INSPECT_TOOL = 'office_document_inspect';
export const PI_OFFICE_DOCUMENT_EDIT_TOOL = 'office_document_edit';
export const PI_OFFICE_DOCUMENT_GUIDE_TOOL = 'office_document_guide';
export const PI_OFFICE_DOCUMENT_PREVIEW_TOOL = 'office_document_preview';
export const PI_OFFICE_DOCUMENT_FINALIZE_TOOL = 'office_document_finalize';

const PI_CANONICAL_SESSION_TOOL_NAMES = new Set([
  PI_OFFICE_DOCUMENT_INSPECT_TOOL,
  PI_OFFICE_DOCUMENT_EDIT_TOOL,
  PI_OFFICE_DOCUMENT_GUIDE_TOOL,
  PI_OFFICE_DOCUMENT_PREVIEW_TOOL,
  PI_OFFICE_DOCUMENT_FINALIZE_TOOL,
]);

/**
 * Office tools are intentionally registered under their canonical public names
 * in Pi. The shared prompt, UI, permission metadata, and model tool call must
 * all agree on one exact name; an MCP-only alias caused real calls to fail with
 * "Tool office_document_inspect not found".
 */
export const PI_OFFICE_TOOL_ROUTING_PROMPT = `## Pi / ORDER Office tool names

For attached .docx, .xlsx, and .pptx files, call the exact registered tools below before using Read, Bash, markitdown, or an automatically generated Markdown sidecar:
- Read, inspect, validate, and query: \`${PI_OFFICE_DOCUMENT_INSPECT_TOOL}\`
- Create or modify: \`${PI_OFFICE_DOCUMENT_EDIT_TOOL}\`
- Load version-pinned task guidance: \`${PI_OFFICE_DOCUMENT_GUIDE_TOOL}\`
- Render or explicitly start an interactive preview: \`${PI_OFFICE_DOCUMENT_PREVIEW_TOOL}\`
- Gate the latest artifact revision before delivery: \`${PI_OFFICE_DOCUMENT_FINALIZE_TOOL}\`

These are native session tools backed by the managed OfficeCLI runtime. Do not replace them with Read, Bash, or markitdown unless the inspect tool reports that the document is unsupported or unavailable.
Only preview.start may open or focus the Selection BrowserPane. Follow the Office document workflow in Document Tools; do not explore with dump or raw.`;

export function getSessionToolProxyDefs(): SessionToolProxyDef[] {
  const definitions = getToolDefsAsJsonSchema({
    prefix: PI_SESSION_TOOL_PREFIX,
    includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
  });

  return definitions.map(definition => {
    const canonicalName = definition.name.startsWith(PI_SESSION_TOOL_PREFIX)
      ? definition.name.slice(PI_SESSION_TOOL_PREFIX.length)
      : definition.name;

    return PI_CANONICAL_SESSION_TOOL_NAMES.has(canonicalName)
      ? { ...definition, name: canonicalName }
      : definition;
  });
}
