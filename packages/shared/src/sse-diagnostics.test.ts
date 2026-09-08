import { expect, it } from 'bun:test';
import { observeSseResponse } from './sse-diagnostics';

it('records only safe transport milestones and preserves SSE bytes', async () => {
  const events: Record<string, unknown>[] = [];
  const response = observeSseResponse(new Response('data: secret-payload\n\n', { headers: { 'x-request-id': 'req-123' } }), Date.now(), e => events.push(e));
  expect(await response.text()).toBe('data: secret-payload\n\n');
  expect(events.map(e => e.phase)).toEqual(['headers', 'first-bytes', 'eof']);
  expect(events[0]?.requestId).toBe('req-123');
  expect(JSON.stringify(events)).not.toContain('secret-payload');
});
it('propagates transport errors without logging their payload', async () => {
  const events: Record<string, unknown>[] = [];
  const error = new Error('private endpoint');
  const source = new ReadableStream({ start(c) { c.error(error); } });
  const response = observeSseResponse(new Response(source), Date.now(), e => events.push(e));
  await expect(response.text()).rejects.toThrow('private endpoint');
  expect(events.at(-1)?.phase).toBe('transport-error');
  expect(JSON.stringify(events)).not.toContain('private endpoint');
});
it('cancels the upstream reader and tolerates a failed logger', async () => {
  let cancelled = false;
  const response = observeSseResponse(new Response(new ReadableStream({ cancel() { cancelled = true; } })), Date.now(), () => { throw new Error('logger failed'); });
  await response.body!.cancel();
  expect(cancelled).toBe(true);
});
it('does not misreport cancellation during a pending read as transport failure', async () => {
  const phases: unknown[] = [];
  const response = observeSseResponse(new Response(new ReadableStream()), Date.now(), e => phases.push(e.phase));
  const reader = response.body!.getReader();
  const pending = reader.read();
  await reader.cancel();
  await pending;
  expect(phases).toEqual(['headers', 'cancelled']);
});
