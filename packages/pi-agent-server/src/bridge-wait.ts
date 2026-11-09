/** Register before sending; every terminal path removes listeners and the pending reply. */
export function waitForBridgeReply<T>(
  pending: Map<string, { resolve: (value: T) => void }>,
  requestId: string,
  options: {
    signal?: AbortSignal;
    interrupted: T;
    timeoutMs?: number;
    timedOut?: T;
    onTimeout?: () => void;
  },
  send: () => void,
): Promise<T> {
  if (options.signal?.aborted) return Promise.resolve(options.interrupted);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      pending.delete(requestId);
    };
    const finish = (value: T) => {
      if (settled) return;
      cleanup(); resolve(value);
    };
    const cancel = () => finish(options.interrupted);
    pending.set(requestId, { resolve: finish });
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.timeoutMs !== undefined) timer = setTimeout(() => {
      if (settled) return;
      finish(options.timedOut ?? options.interrupted);
      // Stop before the resolved promise lets the model consider another action.
      options.onTimeout?.();
    }, options.timeoutMs);
    try { send(); } catch (error) { cleanup(); reject(error); }
  });
}
