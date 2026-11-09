import { describe, expect, it } from 'bun:test';
import { combineProxyToolDefs, nextProxyToolsPayload } from './proxy-tools-sync.ts';

describe('proxy tools sync', () => {
  it('keeps session tools when every source is disabled', () => {
    const session = [{ name: 'mcp__session__call_llm' }];
    expect(combineProxyToolDefs(session, [])).toEqual(session);
  });

  it('drops a disabled source tool from the complete set', () => {
    const session = [{ name: 'mcp__session__call_llm' }];
    const enabled = [{ name: 'mcp__slack__list_channels' }];
    const disabled: Array<{ name: string }> = [];
    expect(combineProxyToolDefs(session, enabled).map(t => t.name)).toEqual([
      'mcp__session__call_llm',
      'mcp__slack__list_channels',
    ]);
    expect(combineProxyToolDefs(session, disabled).map(t => t.name)).toEqual([
      'mcp__session__call_llm',
    ]);
  });

  it('skips a send when the complete set is unchanged', () => {
    const tools = [{ name: 'mcp__session__call_llm' }, { name: 'mcp__slack__list' }];
    const first = nextProxyToolsPayload(null, tools);
    expect(first.shouldSend).toBe(true);
    const second = nextProxyToolsPayload(first.json, tools);
    expect(second.shouldSend).toBe(false);
    const third = nextProxyToolsPayload(first.json, [{ name: 'mcp__session__call_llm' }]);
    expect(third.shouldSend).toBe(true);
  });
});
