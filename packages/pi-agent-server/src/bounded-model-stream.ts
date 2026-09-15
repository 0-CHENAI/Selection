/** A per-request resource bound, independent of semantic progress and tool duration. */
export const MODEL_REQUEST_TIMEOUT_MS = 10 * 60_000;

export async function* boundedModelStream<T>(
  start: (signal: AbortSignal) => AsyncIterable<T>,
  parentSignal?: AbortSignal,
  timeoutMs = MODEL_REQUEST_TIMEOUT_MS,
): AsyncGenerator<T> {
  const controller = new AbortController();
  const abort = () => {
    const error = new Error('Model request cancelled');
    error.name = 'AbortError';
    controller.abort(error);
  };
  parentSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error('Model request time limit reached. Continue this session to resume from recorded work.');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);
  let iterator: AsyncIterator<T> | undefined;
  try {
    if (parentSignal?.aborted) abort();
    if (controller.signal.aborted) throw controller.signal.reason;
    iterator = start(controller.signal)[Symbol.asyncIterator]();
    while (true) {
      // Use a fresh cancellation listener for each read. Racing every chunk
      // against one pending promise retains a reaction per token until timeout.
      const next = await new Promise<IteratorResult<T>>((resolve, reject) => {
        const interrupted = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', interrupted, { once: true });
        const cleanup = () => controller.signal.removeEventListener('abort', interrupted);
        if (controller.signal.aborted) { cleanup(); interrupted(); return; }
        Promise.resolve().then(() => iterator!.next()).then(
          result => { cleanup(); resolve(result); },
          error => { cleanup(); reject(error); },
        );
      });
      if (next.done) return;
      yield next.value;
    }
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
    // Also cancel when the consumer stops early (e.g. a terminal event).
    // Do not await iterator.return(): a broken provider may never resolve it.
    controller.abort();
    try { void iterator?.return?.().catch(() => {}); } catch { /* Best-effort producer cleanup. */ }
  }
}
