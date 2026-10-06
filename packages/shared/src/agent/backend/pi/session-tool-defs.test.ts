import { describe, expect, it } from 'bun:test';
import {
  PI_SESSION_TOOL_PREFIX,
  PI_SESSION_TOOL_SHORT_NAME_ALIASES,
  getSessionToolProxyDefs,
  resolveSessionToolProxyName,
} from './session-tool-defs.ts';

describe('resolveSessionToolProxyName', () => {
  it('keeps the MCP-prefixed spawn_session name', () => {
    expect(resolveSessionToolProxyName('mcp__session__spawn_session')).toBe(
      'mcp__session__spawn_session',
    );
  });

  it('maps the prompt-facing short name to the prefixed dispatch name', () => {
    expect(resolveSessionToolProxyName('spawn_session')).toBe('mcp__session__spawn_session');
    expect(resolveSessionToolProxyName('call_llm')).toBe('mcp__session__call_llm');
  });

  it('maps session__ aliases to the MCP prefix only for known session tools', () => {
    expect(resolveSessionToolProxyName('session__spawn_session')).toBe(
      'mcp__session__spawn_session',
    );
    expect(resolveSessionToolProxyName('session__not_a_tool')).toBe('session__not_a_tool');
  });

  it('leaves unrelated tools unchanged', () => {
    expect(resolveSessionToolProxyName('write')).toBe('write');
    expect(resolveSessionToolProxyName('mcp__slack__post_message')).toBe('mcp__slack__post_message');
  });
});

describe('getSessionToolProxyDefs', () => {
  it('exposes node submissions only to assigned nodes, retaining root verification', () => {
    const root = { id: 'root', workMode: 'PRO' as const, taskSlug: 'plan' };
    const rootNames = getSessionToolProxyDefs({ executionSession: root }).map(def => def.name);
    const nodeNames = getSessionToolProxyDefs({ executionSession: { ...root, id: 'worker', parentSessionId: 'root', taskRunId: 'run', taskNodeId: 'review' } }).map(def => def.name);
    for (const name of ['submit_task_output', 'submit_task_node_verdict', 'task_help']) {
      expect(rootNames).not.toContain(`mcp__session__${name}`);
      expect(nodeNames).toContain(`mcp__session__${name}`);
    }
    expect(rootNames).toContain('mcp__session__submit_task_verdict');
  });
  it('exposes the managed artifact version tool to the model', () => {
    expect(getSessionToolProxyDefs().map(def => def.name)).toContain('mcp__session__artifact_versions');
  });
  it('advertises canonical creation only to eligible PRO roots', () => {
    const pro = getSessionToolProxyDefs({ executionSession: { id: 'root', workMode: 'PRO' } }).map(def => def.name);
    expect(pro).toContain('mcp__session__create_task');
    for (const session of [{ id: 'norm', workMode: 'NORM' as const }, { id: 'worker', workMode: 'PRO' as const, parentSessionId: 'root' }]) {
      expect(getSessionToolProxyDefs({ executionSession: session }).map(def => def.name)).not.toContain('mcp__session__create_task');
    }
  });

  it('registers prompt-facing aliases next to MCP-prefixed names', () => {
    const defs = getSessionToolProxyDefs();
    const names = defs.map(def => def.name);

    for (const shortName of PI_SESSION_TOOL_SHORT_NAME_ALIASES) {
      expect(names).toContain(`${PI_SESSION_TOOL_PREFIX}${shortName}`);
      expect(names).toContain(shortName);
    }
    expect(names).not.toContain('browser_tool');
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives the short-name alias the same schema as the prefixed tool', () => {
    const defs = getSessionToolProxyDefs();
    const prefixed = defs.find(def => def.name === `${PI_SESSION_TOOL_PREFIX}spawn_session`);
    const alias = defs.find(def => def.name === 'spawn_session');

    expect(prefixed).toBeDefined();
    expect(alias).toBeDefined();
    expect(alias?.inputSchema).toEqual(prefixed?.inputSchema);
    expect(alias?.description).toBe(prefixed?.description);
  });
});
