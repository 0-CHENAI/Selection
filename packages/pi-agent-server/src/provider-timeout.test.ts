import { expect, it } from 'bun:test';
import type { Model } from '@earendil-works/pi-ai';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function requestThroughInterceptor(model: Model<'openai-completions'>, requestTimeoutMs = 15000, slotDelayMs?: number) {
  const sessionDir = mkdtempSync(join(tmpdir(), 'provider-297-'));
  const interceptor = resolve(import.meta.dir, '../../shared/src/unified-network-interceptor.ts');
  const budget = resolve(import.meta.dir, './context-budget-stream.ts');
  const code = `
    import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
    import { createContextBudgetedStream } from ${JSON.stringify(pathToFileURL(budget).href)};
    import { setModelRequestGate } from ${JSON.stringify(pathToFileURL(resolve(import.meta.dir, '../../shared/src/model-request-gate.ts')).href)};
    let acquired = 0; const released = [];
    if (${slotDelayMs !== undefined}) setModelRequestGate(async () => {
      acquired++; await new Promise(resolve => setTimeout(resolve, ${slotDelayMs ?? 0}));
      return { release: feedback => released.push(feedback) };
    });
    const response = await createContextBudgetedStream(streamSimple, ${JSON.stringify(model)},
      { messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] },
      { apiKey: 'local-test-only', timeoutMs: ${requestTimeoutMs} }).result();
    console.log(JSON.stringify({ response, settledAt: Date.now(), acquired, released }));
    // Keep the process alive so the test distinguishes cancellation from process exit.
    if (${requestTimeoutMs} < 15000) await new Promise(resolve => setTimeout(resolve, 600));
  `;
  const proc = Bun.spawn([process.execPath, '--preload', interceptor, '--eval', code], {
    cwd: resolve(import.meta.dir, '../../..'),
    env: { ...process.env, CRAFT_SESSION_DIR: sessionDir, CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '0',
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdout: 'pipe', stderr: 'pipe',
  });
  const timeout = setTimeout(() => proc.kill(), 18000);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(exit, stderr).toBe(0);
    return JSON.parse(stdout);
  } finally { clearTimeout(timeout); proc.kill(); rmSync(sessionDir, { recursive: true, force: true }); }
}

it('A8 production interceptor shares its slot hook with the runtime and excludes queue time from provider idle timeout', async () => {
  let requests = 0;
  const server = Bun.serve({ port: 0, fetch() {
    requests++;
    return new Response('data: {"choices":[{"index":0,"delta":{"content":"Ready"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const model: Model<'openai-completions'> = { id: 'local-test', name: 'Local test', api: 'openai-completions', provider: 'openai', baseUrl: `http://127.0.0.1:${server.port}/v1`,
      reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128 };
    const { response, acquired, released } = await requestThroughInterceptor(model, 80, 150);
    expect(response.stopReason, JSON.stringify({ response, acquired, released })).toBe('stop'); expect(requests).toBe(1);
    expect(acquired).toBe(1); expect(released).toEqual([{ status: 200 }]);
  } finally { server.stop(true); }
}, 20_000);


it.each([false, true])('accepts a first token after 10 seconds through the interceptor (heartbeat=%s)', async heartbeat => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const server = Bun.serve({
    port: 0,
    // Keep the fixture alive beyond the deliberately slow upstream prefill.
    idleTimeout: 30,
    fetch() {
      return new Response(new ReadableStream({
        start(controller) {
          // Flush a comment immediately, then model a slow upstream prefill.
          if (heartbeat) controller.enqueue(new TextEncoder().encode(': connected\n\n'));
          timer = setTimeout(() => {
            const chunks = [
              { choices: [{ index: 0, delta: { role: 'assistant', content: 'Ready' }, finish_reason: null }] },
              { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
            ];
            controller.enqueue(new TextEncoder().encode(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'));
            controller.close();
          }, 10_100);
        },
        cancel() { clearTimeout(timer); },
      }), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  try {
    const model: Model<'openai-completions'> = {
      id: 'local-test', name: 'Local test', api: 'openai-completions', provider: 'openai',
      baseUrl: `http://127.0.0.1:${server.port}/v1`, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128,
    };
    const { response } = await requestThroughInterceptor(model);
    expect(response.stopReason).toBe('stop');
    expect(response.content).toContainEqual({ type: 'text', text: 'Ready' });
  } finally {
    clearTimeout(timer);
    server.stop(true);
  }
}, 20000);

it('identifies the exact #297 message as an upstream HTTP 200 SSE error through the production interceptor', async () => {
  const server = Bun.serve({ port: 0, fetch() {
    return new Response('data: {"error":{"message":"The model service is taking too long to respond.","type":"timeout"}}\n\n',
      { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-297-fixture' } });
  } });
  try {
    const model: Model<'openai-completions'> = {
      id: 'local-test', name: 'Local test', api: 'openai-completions', provider: 'openai',
      baseUrl: `http://127.0.0.1:${server.port}/v1`, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128,
    };
    const { response } = await requestThroughInterceptor(model);
    expect(response.stopReason).toBe('error');
    expect(response.errorMessage).toContain('The model service is taking too long to respond.');
    expect(JSON.parse(response.craftTransportDiagnostics[0])).toMatchObject({ phase: 'provider-error', errorCategory: 'timeout', httpStatus: 200, providerRequestId: 'req-297-fixture' });
    expect(JSON.stringify(response.craftTransportDiagnostics)).not.toContain('taking too long');
  } finally { server.stop(true); }
}, 20000);

it.each(['unknown', 'malformed', 'http-error', 'truncated'])('retains structured diagnostics for %s through the SDK', async failure => {
  const server = Bun.serve({ port: 0, fetch() {
    if (failure === 'http-error') return new Response('{"error":{"message":"Denied"}}', { status: 403, headers: { 'content-type': 'application/json', 'x-request-id': 'http-297' } });
    const data = failure === 'unknown' ? '{"error":{"message":"Custom stream failure"}}' : failure === 'truncated' ? '{"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}' : '{broken json';
    return new Response(`data: ${data}\n\n`, { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-297' } });
  } });
  try {
    const model: Model<'openai-completions'> = {
      id: 'local-test', name: 'Local test', api: 'openai-completions', provider: 'openai',
      baseUrl: `http://127.0.0.1:${server.port}/v1`, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128,
    };
    const { response } = await requestThroughInterceptor(model);
    expect(response.stopReason).toBe('error');
    const diagnostic = JSON.parse(response.craftTransportDiagnostics[0]);
    expect(diagnostic.phase).toBe(failure === 'unknown' ? 'provider-error' : failure === 'malformed' ? 'invalid-event' : failure === 'truncated' ? 'eof' : 'http-error');
    expect(diagnostic.attempt).toBeGreaterThan(0);
    expect(diagnostic.providerRequestId).toBe(failure === 'http-error' ? 'http-297' : 'req-297');
  } finally { server.stop(true); }
}, 20000);


it.each([false, true, 'queued'] as const)('bounds an open SSE connection and cancels HTTP transport (partial=%s)', async partial => {
  let cancelledAt = 0;
  const server = Bun.serve({ port: 0, idleTimeout: 30, fetch() {
    return new Response(new ReadableStream({
      start(controller) {
        const data = partial === true
          ? 'data: {"choices":[{"index":0,"delta":{"content":"Recorded work"},"finish_reason":null}]}\n\n'
          : ': connected\n\n';
        controller.enqueue(new TextEncoder().encode(data));
      },
      cancel() { cancelledAt = Date.now(); },
    }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const model: Model<'openai-completions'> = {
      id: 'local-test', name: 'Local test', api: 'openai-completions', provider: 'openai',
      baseUrl: `http://127.0.0.1:${server.port}/v1`, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128,
    };
    const { response, settledAt, acquired, released } = await requestThroughInterceptor(model, 500, partial === 'queued' ? 650 : undefined);
    expect(response.stopReason).toBe('error');
    expect(response.errorMessage).toContain('time limit');
    // Cancellation must reach the server while the child is still alive.
    expect(cancelledAt).toBeGreaterThan(0);
    expect(cancelledAt - settledAt).toBeLessThan(400);
    if (partial === true) expect(response.content).toContainEqual({ type: 'text', text: 'Recorded work' });
    if (partial === 'queued') { expect(acquired).toBe(1); expect(released).toHaveLength(1); }
  } finally { server.stop(true); }
}, 20000);
