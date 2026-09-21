import { describe, expect, it } from 'bun:test';
import { modelVisibleTools, PI_SESSION_TOOL_SHORT_NAME_ALIASES } from './model-visible-tools.ts';
import { getSessionToolProxyDefs } from './session-tool-defs.ts';

describe('model-visible session tools', () => {
  it('removes only duplicate legacy aliases without changing the execution registry', () => {
    const registry = getSessionToolProxyDefs();
    const original = registry.slice();
    const visible = modelVisibleTools(registry);
    for (const name of PI_SESSION_TOOL_SHORT_NAME_ALIASES) {
      if (!registry.some(tool => tool.name === name)) continue;
      expect(registry.some(tool => tool.name === name)).toBe(true);
      expect(visible.some(tool => tool.name === name)).toBe(false);
      expect(visible.find(tool => tool.name === `mcp__session__${name}`))
        .toBe(registry.find(tool => tool.name === `mcp__session__${name}`));
    }
    expect(registry).toEqual(original);
    expect(modelVisibleTools(visible)).toEqual(visible);
  });

  it('keeps standalone aliases, unrelated tools and stable ordering', () => {
    const tools = [{ name: 'call_llm' }, { name: 'read' }, { name: 'mcp__other__read' }];
    expect(modelVisibleTools(tools)).toEqual(tools);
  });
});
