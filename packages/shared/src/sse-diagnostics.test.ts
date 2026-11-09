import { expect, it } from 'bun:test';
import { observeSseResponse } from './sse-diagnostics';

it('records only safe transport milestones and preserves SSE bytes', async () => {
  const events: Record<string, unknown>[] = [];
  const response = observeSseResponse(new Response('data: secret-payload\n\n', { headers: { 'x-request-id': 'req-123' } }), Date.now(), e => events.push(e));
  expect(await response.text()).toBe('data: secret-payload\n\n');
  expect(events.map(e => e.phase)).toEqual(['headers', 'first-bytes', 'first-event', 'invalid-event', 'eof']);
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

it('distinguishes heartbeat, upstream SSE timeout and output across fragmented CRLF frames', async () => {
  const events: Record<string, unknown>[] = [];
  const wire = ': heartbeat\r\n\r\ndata: {"choices":[{"delta":{"content":"secret"}}]}\r\n\r\nevent: error\r\ndata: {"error":{"message":"The model service is taking too long to respond. private-host","code":"secret-code"}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(wire);
  const source = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
  expect(await observeSseResponse(new Response(source), Date.now(), e => events.push(e)).text()).toBe(wire);
  expect(events.map(e => e.phase)).toEqual(['headers', 'first-bytes', 'first-event', 'first-output', 'provider-error', 'done', 'eof']);
  expect(events.find(e => e.phase === 'provider-error')?.errorCategory).toBe('timeout');
  expect(new Set(events.map(e => e.diagnosticId)).size).toBe(1);
  expect(JSON.stringify(events)).not.toMatch(/secret|private-host|taking too long/);
});
it('bounds inspection and resumes after an oversized event without modifying output', async () => {
  const events: Record<string, unknown>[] = [];
  const wire = 'data: ' + 'x'.repeat(100_000) + '\n\ndata: {"error":{"type":"rate_limit_error"}}\n\n';
  expect(await observeSseResponse(new Response(wire), Date.now(), e => events.push(e)).text()).toBe(wire);
  expect(events.filter(e => e.phase === 'event-too-large')).toHaveLength(1);
  expect(events.find(e => e.phase === 'provider-error')?.errorCategory).toBe('rate-limit');
});

it('accepts SSE events delimited by CR alone', async () => {
  const events: Record<string, unknown>[] = [];
  const wire = 'data: {"error":{"type":"timeout"}}\r\r';
  expect(await observeSseResponse(new Response(wire), Date.now(), e => events.push(e)).text()).toBe(wire);
  expect(events.find(e => e.phase === 'provider-error')?.errorCategory).toBe('timeout');
});
