import { describe, expect, it } from 'bun:test';
import {
  OFFICE_MAX_BATCH_FILE_BYTES,
  OFFICE_MAX_INLINE_BATCH_CHARS,
  OFFICE_MAX_INLINE_BATCH_COMMANDS,
} from './office-workflow.ts';
import {
  SESSION_TOOL_DEFS,
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  getToolDefsAsJsonSchema,
} from './tool-defs.ts';

const OFFICE_TOOLS = [
  'office_document_inspect',
  'office_document_edit',
  'office_document_guide',
  'office_document_preview',
  'office_document_finalize',
] as const;

describe('session tool filtering helpers', () => {
  it('respects developer feedback filtering and keeps names/registry aligned', () => {
    expect(getSessionToolDefs({ includeDeveloperFeedback: false }).map(def => def.name))
      .not.toContain('send_developer_feedback');
    expect(getSessionToolDefs({ includeDeveloperFeedback: true }).map(def => def.name))
      .toContain('send_developer_feedback');

    const names = getSessionToolNames({ includeDeveloperFeedback: false });
    const registry = getSessionToolRegistry({ includeDeveloperFeedback: false });
    for (const name of names) expect(registry.has(name)).toBe(true);
    expect(registry.has('send_developer_feedback')).toBe(false);
  });

  it('publishes all five native Office tools for registry, Pi, and MCP clients', () => {
    const registry = getSessionToolRegistry({ includeDeveloperFeedback: false });
    const piDefs = getToolDefsAsJsonSchema({
      prefix: 'mcp__session__',
      includeDeveloperFeedback: false,
    });

    for (const name of OFFICE_TOOLS) {
      expect(registry.get(name)?.executionMode).toBe('registry');
      expect(piDefs.some(def => def.name === `mcp__session__${name}`)).toBe(true);
    }
    expect(registry.get('office_document_inspect')).toMatchObject({ safeMode: 'allow', readOnly: true });
    expect(registry.get('office_document_edit')).toMatchObject({ safeMode: 'block' });
    expect(registry.get('office_document_guide')).toMatchObject({ safeMode: 'allow', readOnly: true });
    expect(registry.get('office_document_preview')).toMatchObject({ safeMode: 'allow' });
    expect(registry.get('office_document_finalize')).toMatchObject({ safeMode: 'allow', readOnly: true });
  });

  it('converts discriminated preview schemas and read-only annotations correctly', () => {
    const defs = getToolDefsAsJsonSchema({ includeDeveloperFeedback: false });
    const preview = defs.find(def => def.name === 'office_document_preview');
    const inspect = defs.find(def => def.name === 'office_document_inspect');
    const finalize = defs.find(def => def.name === 'office_document_finalize');
    const edit = defs.find(def => def.name === 'office_document_edit');

    expect(preview?.inputSchema).toBeTruthy();
    expect(inspect?.annotations).toEqual({ readOnlyHint: true });
    expect(finalize?.annotations).toEqual({ readOnlyHint: true });
    expect(edit?.annotations).toBeUndefined();
  });

  it('classifies safe-mode tools and supports MCP prefixing', () => {
    const allowed = getSessionSafeAllowedToolNames();
    const blocked = getSessionSafeBlockedToolNames();
    expect(allowed.has('office_document_inspect')).toBe(true);
    expect(allowed.has('office_document_guide')).toBe(true);
    expect(allowed.has('office_document_preview')).toBe(true);
    expect(allowed.has('office_document_finalize')).toBe(true);
    expect(blocked.has('office_document_edit')).toBe(true);

    const prefixed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    expect(prefixed.has('mcp__session__office_document_preview')).toBe(true);
    expect(getSessionSafeBlockedToolNames({ prefix: 'mcp__session__' })
      .has('mcp__session__office_document_edit')).toBe(true);
  });

  it('publishes argv and structured batch limits in the edit schema', () => {
    const defs = getToolDefsAsJsonSchema({ includeDeveloperFeedback: false });
    const edit = defs.find(def => def.name === 'office_document_edit');
    const inspect = defs.find(def => def.name === 'office_document_inspect');
    const editSchema = edit?.inputSchema as {
      properties?: Record<string, { description?: string; properties?: Record<string, { description?: string }> }>;
    };
    const editProperties = editSchema.properties ?? {};
    const batchProperties = editProperties.batch?.properties ?? {};

    expect(editProperties.argv?.description).toContain('Native OfficeCLI tokens');
    expect(batchProperties.commands?.description).toContain(String(OFFICE_MAX_INLINE_BATCH_COMMANDS));
    expect(batchProperties.commands?.description).toContain(String(OFFICE_MAX_INLINE_BATCH_CHARS));
    expect(batchProperties.file?.description).toContain('.json');
    expect(edit?.description).toContain(String(OFFICE_MAX_BATCH_FILE_BYTES));
    expect((inspect?.inputSchema as { properties?: Record<string, { description?: string }> })
      .properties?.argv?.description).toContain('Native tokens');
  });

  it('all canonical session tools declare safeMode metadata', () => {
    for (const def of SESSION_TOOL_DEFS) {
      expect(def.safeMode === 'allow' || def.safeMode === 'block').toBe(true);
    }
  });
});
