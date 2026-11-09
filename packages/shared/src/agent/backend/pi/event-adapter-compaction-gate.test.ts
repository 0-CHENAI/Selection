import { expect, it } from 'bun:test';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { PiEventAdapter } from './event-adapter.ts';

it('shows the hard request-gate error without waiting for overflow recovery', () => {
  const adapter = new PiEventAdapter();
  adapter.setContextWindow(200_000);
  adapter.startTurn();
  const message: AssistantMessage & { craftContextLimit: true } = {
    role: 'assistant', content: [], api: 'openai-responses', provider: 'openai', model: 'test',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error', errorMessage: '当前请求已达到上下文安全上限，无法安全发送。', craftContextLimit: true, timestamp: 1,
  };
  const events = [...adapter.adaptEvent({ type: 'message_end', message })];
  expect(events.some(event => event.type === 'typed_error' && event.error.code === 'context_limit' && !event.error.canRetry)).toBe(true);
  expect(events.some(event => event.type === 'error')).toBe(false);
  expect(adapter.shouldCompleteQueue(true)).toBe(true);
  const legacy = new PiEventAdapter();
  legacy.startTurn();
  const { craftContextLimit: _marker, ...unmarked } = message;
  expect([...legacy.adaptEvent({ type: 'message_end', message: unmarked })])
    .toContainEqual({ type: 'error', message: message.errorMessage! });
  const ordinary = new PiEventAdapter();
  ordinary.startTurn();
  expect([...ordinary.adaptEvent({ type: 'message_end', message: {
    ...message, stopReason: 'stop', content: [{ type: 'text', text: message.errorMessage! }],
  } })].some(event => event.type === 'typed_error' || event.type === 'error')).toBe(false);
});
