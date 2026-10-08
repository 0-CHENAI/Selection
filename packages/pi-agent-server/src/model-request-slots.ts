import { randomUUID } from 'node:crypto';
import type { ModelRequestGate, ModelRequestFeedback, ModelRequestLease } from '../../shared/src/model-request-gate';
export type ModelRequestSlotMessage = { type: 'model_request_acquire'; requestId: string }
  | ({ type: 'model_request_release'; requestId: string } & ModelRequestFeedback);
/** Transport cancellation is distinct from HTTP retry; every dispatched attempt asks for a fresh slot. */
export function createModelRequestSlots(send: (message: ModelRequestSlotMessage) => void) {
  const requests = new Map<string, { resolve: (lease: ModelRequestLease) => void; reject: (reason: unknown) => void; signal?: AbortSignal; cancel: () => void; release: (feedback?: ModelRequestFeedback) => void }>();
  const acquire: ModelRequestGate = signal => {
    signal?.throwIfAborted();
    const requestId = `model-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const release = (feedback?: ModelRequestFeedback) => {
        if (!requests.delete(requestId)) return;
        signal?.removeEventListener('abort', cancel);
        send({ type: 'model_request_release', requestId, ...feedback });
      };
      const cancel = () => { release(); reject(signal?.reason ?? new Error('Model request cancelled')); };
      requests.set(requestId, { resolve, reject, signal, cancel, release });
      signal?.addEventListener('abort', cancel, { once: true });
      send({ type: 'model_request_acquire', requestId });
      if (signal?.aborted) cancel();
    });
  };
  return { acquire,
    granted(requestId: string, error?: string) {
      const request = requests.get(requestId);
      if (!request) { send({ type: 'model_request_release', requestId }); return; }
      if (error) { request.release(); request.reject(new Error(error)); }
      else request.resolve({ release: request.release });
    },
    close() {
      for (const request of [...requests.values()]) { request.release(); request.reject(new Error('Model request transport closed')); }
    },
  };
}
