import { describe, expect, it } from 'bun:test';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { snapshotContextBreakdown } from './context-breakdown.ts';

describe('snapshotContextBreakdown', () => {
  it('returns undefined without a session', () => {
    expect(snapshotContextBreakdown(null)).toBeUndefined();
  });

  it('estimates system, tools, and messages from the live agent state', () => {
    const session = {
      agent: {
        state: {
          systemPrompt: 'System '.repeat(400),
          tools: [{
            name: 'search',
            description: 'Search a large catalog',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          }],
          messages: [
            { role: 'user', content: '请分析附件。', timestamp: 1 },
          ],
        },
      },
    } as unknown as AgentSession;

    const breakdown = snapshotContextBreakdown(session);
    expect(breakdown?.systemPrompt).toBeGreaterThan(0);
    expect(breakdown?.tools).toBeGreaterThan(0);
    expect(breakdown?.messages).toBeGreaterThan(0);
  });

  it('does not treat empty arrays as a real context snapshot', () => {
    const session = {
      agent: {
        state: {
          systemPrompt: '',
          tools: [],
          messages: [],
        },
      },
    } as unknown as AgentSession;

    expect(snapshotContextBreakdown(session)).toBeUndefined();
  });

  it('counts a saved compaction summary without crashing after compaction_end', () => {
    const session = {
      agent: {
        state: {
          systemPrompt: '',
          tools: [],
          messages: [
            { role: 'compactionSummary', summary: '保留用户目标和后续步骤。', tokensBefore: 221820, timestamp: 1 },
            { role: 'user', content: '继续调研。', timestamp: 2 },
          ],
        },
      },
    } as unknown as AgentSession;

    expect(snapshotContextBreakdown(session)?.messages).toBeGreaterThan(0);
  });

  it('uses the prompt projected for the current request instead of the saved SDK prompt', () => {
    const session = {
      systemPrompt: '当前指令。'.repeat(200),
      agent: { state: { systemPrompt: 'Old SDK prompt', tools: [], messages: [
        { role: 'system', content: 'Old SDK prompt', timestamp: 0 },
        { role: 'user', content: '继续', timestamp: 1 },
      ] } },
    } as unknown as AgentSession;
    const breakdown = snapshotContextBreakdown(session);
    expect(breakdown?.systemPrompt).toBeGreaterThan(200);
    expect(breakdown?.messages).toBeGreaterThan(0);
  });
});

it('counts only model-visible schemas while leaving runtime aliases registered', () => {
  const canonical = { name: 'mcp__session__call_llm', description: 'Delegate', parameters: { type: 'object' } };
  const state = { systemPrompt: 'System', tools: [canonical, { ...canonical, name: 'call_llm' }], messages: [] };
  const session = { agent: { state } } as unknown as AgentSession;
  const stats = snapshotContextBreakdown(session);
  expect(stats).toEqual(snapshotContextBreakdown({ agent: { state: { ...state, tools: [canonical] } } } as unknown as AgentSession));
  expect(state.tools).toHaveLength(2);
});
