import { expect, it } from 'bun:test';
import type { Model } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';

it('accepts an HTTP 200 SSE response whose first token arrives after 10 seconds (#297)', async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(new ReadableStream({
        start(controller) {
          // Flush a comment immediately, then model a slow upstream prefill.
          controller.enqueue(new TextEncoder().encode(': connected\n\n'));
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
    const response = await streamSimple(model, { messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] }, { apiKey: 'local-test-only', timeoutMs: 15000 }).result();
    expect(response.stopReason).toBe('stop');
    expect(response.content).toContainEqual({ type: 'text', text: 'Ready' });
  } finally {
    clearTimeout(timer);
    server.stop(true);
  }
}, 20000);
