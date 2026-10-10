import { expect, it } from 'bun:test';
import { PiEventAdapter } from './event-adapter';
type PiEvent = Parameters<PiEventAdapter['adaptEvent']>[0];

const failure = (errorMessage = 'Connection error: fetch failed', craftTransportDiagnostics?: string[]) => ({
  type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage, craftTransportDiagnostics },
}) as unknown as PiEvent;

it('keeps the queue open across retry and emits no durable error when work resumes', () => {
  const adapter = new PiEventAdapter(); adapter.startTurn();
  const emitted = [...adapter.adaptEvent(failure())];
  emitted.push(...adapter.adaptEvent({ type: 'agent_end', messages: [], willRetry: true } as PiEvent));
  expect(adapter.shouldCompleteQueue(true)).toBe(false);
  emitted.push(...adapter.adaptEvent({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: 'fetch failed' }));
  expect([...adapter.adaptEvent({ type: 'agent_start' })]).toEqual([{ type: 'status', message: '' }]);
  emitted.push(...adapter.adaptEvent({ type: 'auto_retry_end', success: true, attempt: 1 }));
  emitted.push(...adapter.adaptEvent({ type: 'agent_end', messages: [], willRetry: false } as PiEvent));
  expect(emitted.filter(event => event.type === 'typed_error' || event.type === 'error')).toEqual([]);
  expect(emitted.filter(event => event.type === 'complete')).toHaveLength(1);
  expect(adapter.shouldCompleteQueue(true)).toBe(true);
});

it.each([0, 3])('reports only the final failed attempt with diagnostics after %s retries', retries => {
  const adapter = new PiEventAdapter(); adapter.startTurn();
  for (let attempt = 1; attempt <= retries; attempt++) {
    expect([...adapter.adaptEvent(failure('fetch failed', [`attempt-${attempt}`]))]).toEqual([]);
    expect([...adapter.adaptEvent({ type: 'agent_end', messages: [], willRetry: true } as PiEvent)]).toEqual([]);
    expect(adapter.shouldCompleteQueue(true)).toBe(false);
    [...adapter.adaptEvent({ type: 'auto_retry_start', attempt, maxAttempts: retries, delayMs: 0, errorMessage: 'fetch failed' })];
  }
  expect([...adapter.adaptEvent(failure('fetch failed', ['final-request']))]).toEqual([]);
  const terminal = [...adapter.adaptEvent({ type: 'agent_end', messages: [], willRetry: false } as PiEvent)];
  expect(terminal).toMatchObject([{ type: 'typed_error', error: { code: 'network_error', details: ['final-request'] } }, { type: 'complete' }]);
  expect([...adapter.adaptEvent({ type: 'auto_retry_end', success: false, attempt: retries, finalError: 'fetch failed' })]).toEqual([]);
  expect(adapter.shouldCompleteQueue(true)).toBe(true);
});

it('finishes a retry cancelled during backoff without waiting for another agent_end', () => {
  const adapter = new PiEventAdapter(); adapter.startTurn();
  [...adapter.adaptEvent(failure())];
  [...adapter.adaptEvent({ type: 'agent_end', messages: [], willRetry: true } as PiEvent)];
  const terminal = [...adapter.adaptEvent({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'Retry cancelled' })];
  expect(terminal).toMatchObject([{ type: 'error' }, { type: 'complete' }]);
  expect(adapter.shouldCompleteQueue(false)).toBe(true);
});
