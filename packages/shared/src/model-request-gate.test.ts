import { afterEach, expect, test } from 'bun:test';
import { fetchWithModelRequestSlot, setModelRequestGate, type ModelRequestFeedback, type ModelFetcher } from './model-request-gate';
import { createRequestDiagnosticScope, runWithRequestDiagnostics } from './request-diagnostics';
afterEach(() => setModelRequestGate(undefined));
const scoped = <T>(fn: () => T) => runWithRequestDiagnostics(createRequestDiagnosticScope(), fn);

test('A8 preserves streaming chunks and holds the slot until EOF; non-model tool requests do not acquire', async () => {
  const releases: Array<ModelRequestFeedback | undefined> = []; let acquired = 0;
  setModelRequestGate(async () => { acquired++; return { release: value => releases.push(value) }; });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = (async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'content-type': 'text/event-stream' } })) as ModelFetcher;
  const response = await scoped(() => fetchWithModelRequestSlot(fetcher, 'https://model.example', {}));
  expect(releases).toHaveLength(0);
  stream.enqueue(new TextEncoder().encode('data: chunk\n\n')); stream.close();
  expect(await response.text()).toBe('data: chunk\n\n'); expect(releases).toEqual([{ status: 200, retryAfter: undefined }]);
  await fetchWithModelRequestSlot((async () => new Response('tool')) as ModelFetcher, 'https://source.example');
  expect(acquired).toBe(1);
});

test('A8 errors release on headers before body consumption; cancellation and fetch failure release exactly once', async () => {
  const releases: Array<ModelRequestFeedback | undefined> = [];
  setModelRequestGate(async () => ({ release: value => releases.push(value) }));
  const error = await scoped(() => fetchWithModelRequestSlot((async () => new Response('slow error body', { status: 429, headers: { 'retry-after': '12' } })) as ModelFetcher, 'https://model.example'));
  expect(releases).toEqual([{ status: 429, retryAfter: '12' }]); expect(await error.text()).toBe('slow error body');
  const response = await scoped(() => fetchWithModelRequestSlot((async () => new Response(new ReadableStream())) as ModelFetcher, 'https://model.example'));
  await response.body!.cancel(); expect(releases).toHaveLength(2);
  await expect(scoped(() => fetchWithModelRequestSlot((async () => { throw new Error('transport'); }) as ModelFetcher, 'https://model.example'))).rejects.toThrow('transport');
  expect(releases).toHaveLength(3);
});

test('A8 cancellation while awaiting a host grant never dispatches an HTTP request and returns a late lease', async () => {
  const controller = new AbortController(); let grant!: () => void, released = 0, fetched = 0;
  setModelRequestGate(() => new Promise(resolve => { grant = () => resolve({ release: () => released++ }); }));
  const pending = scoped(() => fetchWithModelRequestSlot((async () => { fetched++; return new Response('wrong'); }) as ModelFetcher, 'https://model.example', { signal: controller.signal }));
  controller.abort(); grant(); await expect(pending).rejects.toThrow();
  expect(fetched).toBe(0); expect(released).toBe(1);
});
