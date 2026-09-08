/** Observe transport milestones without recording request bodies, URLs, or response text. */
export function observeSseResponse(response: Response, startedAt: number, log: (event: Record<string, unknown>) => void): Response {
  if (!response.body) return response;
  const candidate = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  const requestId = candidate && /^[a-zA-Z0-9_.:-]{1,128}$/.test(candidate) ? candidate : undefined;
  const base = { httpStatus: response.status, requestId, transport: 'sse' };
  const report = (phase: string) => {
    try { log({ ...base, phase, elapsedMs: Math.max(0, Date.now() - startedAt) }); } catch { /* Diagnostics must not interrupt model output. */ }
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
