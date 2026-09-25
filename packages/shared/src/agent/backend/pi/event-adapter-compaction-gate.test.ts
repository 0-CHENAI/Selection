import { expect, it } from 'bun:test';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { PiEventAdapter } from './event-adapter.ts';

it('shows the hard request-gate error without waiting for overflow recovery', () => {
  const adapter = new PiEventAdapter();
  adapter.setContextWindow(200_000);
  adapter.startTurn();
  const message: AssistantMessage = {
    role: 'assistant', content: [], api: 'openai-responses', provider: 'openai', model: 'test',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error', errorMessage: '当前请求已达到上下文安全上限，无法安全发送。', timestamp: 1,
  };
  const events = [...adapter.adaptEvent({ type: 'message_end', message })];
  expect(events.some(event => event.type === 'error' && event.message === message.errorMessage)).toBe(true);
  expect(adapter.shouldCompleteQueue(true)).toBe(true);
});
