import { hasModelRequestDiagnosticScope, beginModelRequestQueue } from './request-diagnostics';
/** Host-owned request slots shared by the preload interceptor and bundled Pi runtime. */
export interface ModelRequestFeedback { status?: number; retryAfter?: string }
export interface ModelRequestLease { release(feedback?: ModelRequestFeedback): void }
export type ModelRequestGate = (signal?: AbortSignal) => Promise<ModelRequestLease>;
export type ModelFetcher = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;
const key = Symbol.for('selection.model-request-gate');
const shared = globalThis as typeof globalThis & { [key]?: ModelRequestGate };
export function setModelRequestGate(gate: ModelRequestGate | undefined): void { shared[key] = gate; }
export function hasModelRequestGate(): boolean { return !!shared[key]; }

/** A streaming response owns its slot until EOF, cancellation or failure. */
export async function fetchWithModelRequestSlot(fetcher: ModelFetcher, input: string | Request | URL, init?: RequestInit): Promise<Response> {
  const gate = hasModelRequestDiagnosticScope() ? shared[key] : undefined;
  if (!gate) return fetcher(input, init);
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;
  signal?.throwIfAborted();
  const endQueue = beginModelRequestQueue();
  let lease: ModelRequestLease;
  try { lease = await gate(signal); } finally { endQueue(); }
  let finished = false;
  const release = (feedback?: ModelRequestFeedback) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener('abort', onAbort);
    lease.release(feedback);
  };
  const onAbort = () => release();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    const response = await fetcher(input, init);
    const feedback = { status: response.status, retryAfter: response.headers.get('retry-after') ?? undefined };
    if (response.status >= 400 || !response.body) { release(feedback); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { release(feedback); controller.close(); }
          else controller.enqueue(next.value);
        } catch (error) { release(); controller.error(error); }
      },
      async cancel(reason) { release(); await reader.cancel(reason); },
    });
    const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    for (const property of ['url', 'redirected', 'type'] as const) Object.defineProperty(wrapped, property, { value: response[property] });
    return wrapped;
  } catch (error) { release(); throw error; }
}
