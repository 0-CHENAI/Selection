import { describe, expect, it } from 'bun:test';
import { replaceProxyTools, type ProxyToolDef } from './register-tools.ts';

function tool(name: string): ProxyToolDef {
  return { name, description: name, inputSchema: { type: 'object', properties: {} } };
}

describe('replaceProxyTools', () => {
  it('replaces the set so a disabled source tool disappears', () => {
    const current = [tool('mcp__session__call_llm'), tool('mcp__slack__post')];
    const incoming = [tool('mcp__session__call_llm')];
    const result = replaceProxyTools(current, incoming);
    expect(result.changed).toBe(true);
    expect(result.tools.map(t => t.name)).toEqual(['mcp__session__call_llm']);
  });

  it('does not mark a rebuild when the same set is sent again', () => {
    const tools = [tool('mcp__session__call_llm'), tool('mcp__slack__list')];
    const result = replaceProxyTools(tools, tools);
    expect(result.changed).toBe(false);
    expect(result.tools).toEqual(tools);
  });

  it('can replace with an empty list', () => {
    const result = replaceProxyTools([tool('mcp__slack__post')], []);
    expect(result.changed).toBe(true);
    expect(result.tools).toEqual([]);
  });
});
