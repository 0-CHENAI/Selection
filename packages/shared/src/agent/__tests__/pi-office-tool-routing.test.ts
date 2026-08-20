import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getSessionToolProxyDefs,
  PI_OFFICE_DOCUMENT_EDIT_TOOL,
  PI_OFFICE_DOCUMENT_INSPECT_TOOL,
  PI_OFFICE_TOOL_ROUTING_PROMPT,
} from '../backend/pi/session-tool-defs.ts';

describe('Pi Office tool routing', () => {
  it('names the exact registered proxy tools in the Pi routing prompt', () => {
    const registeredNames = new Set(getSessionToolProxyDefs().map(def => def.name));

    expect(registeredNames.has(PI_OFFICE_DOCUMENT_INSPECT_TOOL)).toBe(true);
    expect(registeredNames.has(PI_OFFICE_DOCUMENT_EDIT_TOOL)).toBe(true);
    expect(registeredNames.has(`mcp__session__${PI_OFFICE_DOCUMENT_INSPECT_TOOL}`)).toBe(false);
    expect(registeredNames.has(`mcp__session__${PI_OFFICE_DOCUMENT_EDIT_TOOL}`)).toBe(false);
    expect(registeredNames.has('mcp__session__call_llm')).toBe(true);
    expect(PI_OFFICE_TOOL_ROUTING_PROMPT).toContain(PI_OFFICE_DOCUMENT_INSPECT_TOOL);
    expect(PI_OFFICE_TOOL_ROUTING_PROMPT).toContain(PI_OFFICE_DOCUMENT_EDIT_TOOL);
    expect(PI_OFFICE_TOOL_ROUTING_PROMPT).toContain('native session tools');
    expect(PI_OFFICE_TOOL_ROUTING_PROMPT).toContain('Office document workflow');
    expect(PI_OFFICE_TOOL_ROUTING_PROMPT).toContain('Document Tools');
    expect(PI_OFFICE_TOOL_ROUTING_PROMPT).not.toContain('write the structure in one batch');
  });

  it('routes Office attachments before the generic Markdown-sidecar branch', () => {
    const source = readFileSync(join(__dirname, '..', 'pi-agent.ts'), 'utf8');
    const normalizedSource = source.replace(/\r\n/g, '\n');
    const officeBranchStart = source.indexOf("att.type === 'office' && att.storedPath");
    const genericBranchStart = source.indexOf('} else if (att.storedPath) {', officeBranchStart);

    expect(officeBranchStart).toBeGreaterThan(-1);
    expect(genericBranchStart).toBeGreaterThan(officeBranchStart);

    const officeBranch = source.slice(officeBranchStart, genericBranchStart);
    expect(officeBranch).toContain('PI_OFFICE_DOCUMENT_INSPECT_TOOL');
    expect(officeBranch).toContain('PI_OFFICE_DOCUMENT_EDIT_TOOL');
    expect(officeBranch).not.toContain('att.markdownPath');
    expect(normalizedSource).toContain('systemPrompt,\n        PI_OFFICE_TOOL_ROUTING_PROMPT,');
  });

  it('strips legacy Office Markdown sidecars at the renderer boundary', () => {
    const rendererSource = readFileSync(join(
      __dirname,
      '..', '..', '..', '..', '..',
      'apps', 'electron', 'src', 'renderer', 'App.tsx',
    ), 'utf8');

    expect(rendererSource).toContain(
      "markdownPath: stored.type === 'office' ? undefined : stored.markdownPath",
    );
  });
});
