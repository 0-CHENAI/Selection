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
});
