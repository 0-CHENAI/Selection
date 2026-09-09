import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestDiagnostic {
  invocationId: string;
  requestId: string;
  attempt: number;
  phase: string;
  elapsedMs: number;
  firstByteMs?: number;
  firstEventMs?: number;
  firstOutputMs?: number;
  httpStatus?: number;
  providerRequestId?: string;
  errorCategory?: string;
}
export interface RequestDiagnosticScope {
  invocationId: string;
  attempts: number;
  latest?: RequestDiagnostic;
}
// Preload and bundled runtime must share the same async context, without a session-global last error.
const key = Symbol.for('selection.request-diagnostics');
const shared = globalThis as typeof globalThis & { [key]?: AsyncLocalStorage<RequestDiagnosticScope> };
const storage = shared[key] ??= new AsyncLocalStorage<RequestDiagnosticScope>();
export function createRequestDiagnosticScope(): RequestDiagnosticScope {
  return { invocationId: randomUUID(), attempts: 0 };
}
export function runWithRequestDiagnostics<T>(scope: RequestDiagnosticScope, fn: () => T): T {
  return storage.run(scope, fn);
}
export function beginRequestDiagnostic(): (event: Record<string, unknown>) => void {
  const scope = storage.getStore();
  if (!scope) return () => {};
  const started = Date.now();
  const record: RequestDiagnostic = { invocationId: scope.invocationId, requestId: randomUUID(),
    attempt: ++scope.attempts, phase: 'request', elapsedMs: 0 };
  scope.latest = record;
  return event => {
    // A late completion of an earlier HTTP retry cannot replace the current request.
    if (scope.latest !== record) return;
    const elapsedMs = Math.max(0, Date.now() - started);
    if (event.phase === 'first-bytes') record.firstByteMs ??= elapsedMs;
    if (event.phase === 'first-event') record.firstEventMs ??= elapsedMs;
    if (event.phase === 'first-output') record.firstOutputMs ??= elapsedMs;
    if (typeof event.httpStatus === 'number') record.httpStatus = event.httpStatus;
    if (typeof event.requestId === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(event.requestId)) record.providerRequestId = event.requestId;
    // Preserve the reason for failure even if the reader subsequently closes/cancels.
    if (!['provider-error', 'transport-error', 'invalid-event', 'event-too-large'].includes(record.phase)) {
      record.elapsedMs = elapsedMs;
      if (typeof event.phase === 'string') record.phase = event.phase;
    }
    if (typeof event.errorCategory === 'string') record.errorCategory = event.errorCategory;
  };
}
export function requestDiagnosticDetails(scope: RequestDiagnosticScope): string[] {
  return [JSON.stringify(scope.latest ?? { invocationId: scope.invocationId, attempt: 0, phase: 'sdk-error', elapsedMs: 0 })];
}
