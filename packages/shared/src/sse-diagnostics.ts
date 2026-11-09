import { randomUUID } from 'node:crypto';

/** Observe transport milestones without recording request bodies, URLs, or response text. */
export function observeSseResponse(response: Response, startedAt: number, log: (event: Record<string, unknown>) => void): Response {
  if (!response.body) return response;
  const candidate = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  const requestId = candidate && /^[a-zA-Z0-9_.:-]{1,128}$/.test(candidate) ? candidate : undefined;
  const base = { httpStatus: response.status, requestId, transport: 'sse', diagnosticId: randomUUID() };
  const reported = new Set<string>();
  const report = (phase: string, extra: Record<string, unknown> = {}) => {
    if (reported.has(phase)) return;
    reported.add(phase);
    try { log({ ...base, ...extra, phase, elapsedMs: Math.max(0, Date.now() - startedAt) }); } catch { /* Diagnostics must not interrupt model output. */ }
  };
  // Inspect a bounded copy only. Never modify bytes or log provider text/tool arguments.
  const decoder = new TextDecoder();
  const limit = 64 * 1024;
  let line = '';
  let data = '';
  let eventType = '';
  let oversized = false;
  let firstEvent = true;
  let firstOutput = true;
  const dispatch = () => {
    if (!oversized && data) {
      if (firstEvent) { firstEvent = false; report('first-event'); }
      if (data.trim() === '[DONE]') report('done');
      else {
        try {
          const value = JSON.parse(data);
          if (value && typeof value === 'object') {
            if (value.error || value.type === 'error' || value.type === 'response.failed' || eventType === 'error') {
              const error = value.error ?? value.response?.error ?? value;
              const hint = `${error?.type ?? ''} ${error?.code ?? ''} ${error?.message ?? ''}`;
              const errorCategory = /timeout|timed? out|taking too long/i.test(hint) ? 'timeout'
                : /rate.?limit|too many requests/i.test(hint) ? 'rate-limit'
                : /authentication|invalid.api.key|unauthorized/i.test(hint) ? 'authentication' : 'upstream-error';
              report('provider-error', { errorCategory });
            }
            const delta = value.choices?.[0]?.delta;
            const hasOutput = delta?.content || delta?.reasoning_content || delta?.tool_calls?.length
              || value.type === 'content_block_delta' || value.type === 'response.output_text.delta'
              || value.type === 'response.function_call_arguments.delta';
            if (firstOutput && hasOutput) { firstOutput = false; report('first-output'); }
          }
        } catch { report('invalid-event'); }
      }
    }
    data = ''; eventType = ''; oversized = false;
  };
  const acceptLine = () => {
    const value = line.endsWith('\r') ? line.slice(0, -1) : line;
    line = '';
    if (!value) { dispatch(); return; }
    if (oversized) return;
    if (value.startsWith('data:')) data += (data ? '\n' : '') + value.slice(5).replace(/^ /, '');
    else if (value.startsWith('event:')) eventType = value.slice(6).trim();
    if (data.length > limit) { oversized = true; data = ''; report('event-too-large'); }
  };
  let previousCR = false;
  const inspect = (bytes: Uint8Array) => {
    for (const char of decoder.decode(bytes, { stream: true })) {
      if (char === '\n' && previousCR) { previousCR = false; continue; }
      previousCR = char === '\r';
      if (char === '\n' || char === '\r') acceptLine();
      else if (line.length < limit) line += char;
      else if (!oversized) { oversized = true; data = ''; report('event-too-large'); }
    }
  };
  report('headers');
  const reader = response.body.getReader();
  let first = true;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (cancelled) return;
        if (chunk.done) { report('eof'); controller.close(); reader.releaseLock(); return; }
        if (first) { first = false; report('first-bytes'); }
        inspect(chunk.value);
        controller.enqueue(chunk.value);
      } catch (error) {
        if (cancelled) return;
        report('transport-error');
        controller.error(error);
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      cancelled = true;
      report('cancelled');
      try { await reader.cancel(reason); } finally { reader.releaseLock(); }
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
