import type { ModelRequestFeedback, ModelRequestLease } from '@craft-agent/shared/model-request-gate';
type Waiter = { owner: string; resolve: (lease: ModelRequestLease) => void; reject: (error: unknown) => void; signal?: AbortSignal; cancel: () => void };
type RequestQuota = { active: number; cap: number; epoch: number; successes: number; throttles: number; retryAt: number; owners: Map<string, Waiter[]>; lastOwner?: string; timer?: ReturnType<typeof setTimeout> };

export function retryAfterMs(value: string | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) { const ms = Number(value) * 1000; return Number.isFinite(ms) ? ms : undefined; }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** One host pool: request slots are shared across workspaces and fair between runs. */
export class LlmConnectionPool {
  private readonly inFlight = new Map<string, number>();
  private readonly waiters: Array<{ connection: string; resolve: () => void }> = [];
  private readonly quotas = new Map<string, RequestQuota>();

  constructor(private readonly defaultLimit = 4) {}

  requestState(quota: string): { active: number; cap: number; queued: number; retryAt: number } {
    const state = this.quotas.get(quota);
    return state ? { active: state.active, cap: state.cap, queued: [...state.owners.values()].reduce((sum, queue) => sum + queue.length, 0), retryAt: state.retryAt }
      : { active: 0, cap: this.defaultLimit, queued: 0, retryAt: 0 };
  }

  acquireRequest(quota: string, owner: string, signal?: AbortSignal): Promise<ModelRequestLease> {
    signal?.throwIfAborted();
    let state = this.quotas.get(quota);
    if (!state) {
      state = { active: 0, cap: Math.max(1, this.defaultLimit), epoch: 0, successes: 0, throttles: 0, retryAt: 0, owners: new Map() };
      this.quotas.set(quota, state);
    }
    const current = state;
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { owner, signal, resolve, reject, cancel: () => {
        const queue = current.owners.get(owner), index = queue?.indexOf(waiter) ?? -1;
        if (index >= 0) queue!.splice(index, 1);
        if (!queue?.length) current.owners.delete(owner);
        signal?.removeEventListener('abort', waiter.cancel);
        reject(signal?.reason ?? new Error('Model request cancelled'));
        this.pump(current);
      } };
      const queue = current.owners.get(owner) ?? [];
      queue.push(waiter); current.owners.set(owner, queue);
      signal?.addEventListener('abort', waiter.cancel, { once: true });
      if (signal?.aborted) waiter.cancel(); else this.pump(current);
    });
  }

  private pump(state: RequestQuota): void {
    if (state.timer) { clearTimeout(state.timer); state.timer = undefined; }
    if (!state.owners.size) return;
    const delay = state.retryAt - Date.now();
    if (delay > 0) {
      state.timer = setTimeout(() => { state.timer = undefined; this.pump(state); }, Math.min(delay, 2_147_483_647));
      state.timer.unref(); return;
    }
    while (state.active < state.cap && state.owners.size) {
      const owners = [...state.owners.keys()];
      const index = owners.indexOf(state.lastOwner ?? '');
      const owner = owners[(index + 1) % owners.length]!;
      const queue = state.owners.get(owner)!, waiter = queue.shift()!;
      if (!queue.length) state.owners.delete(owner);
      waiter.signal?.removeEventListener('abort', waiter.cancel);
      state.lastOwner = owner; state.active++;
      const admittedEpoch = state.epoch;
      let released = false;
      const release = (feedback?: ModelRequestFeedback) => {
        if (released) return;
        released = true; waiter.signal?.removeEventListener('abort', cancel); state.active--;
        if (feedback?.status === 429 || feedback?.status === 503) {
          // Adjust once per admission epoch; late failures still extend server cooldown.
          if (admittedEpoch === state.epoch) {
            state.cap = Math.max(1, Math.floor(state.cap / 2)); state.successes = 0; state.throttles++; state.epoch++;
          }
          const retry = retryAfterMs(feedback.retryAfter) ?? Math.min(60_000, 1000 * 2 ** Math.min(6, Math.max(0, state.throttles - 1)));
          state.retryAt = Math.max(state.retryAt, Date.now() + retry);
        } else if (admittedEpoch === state.epoch && feedback?.status && feedback.status < 400) {
          state.throttles = 0;
          if (++state.successes >= state.cap && Date.now() >= state.retryAt) {
            const cap = Math.min(this.defaultLimit, state.cap + 1);
            if (cap !== state.cap) { state.cap = cap; state.epoch++; }
            state.successes = 0;
          }
        }
        this.pump(state);
      };
      const cancel = () => release();
      waiter.signal?.addEventListener('abort', cancel, { once: true });
      waiter.resolve({ release });
      if (waiter.signal?.aborted) release();
    }
  }

  inUse(connection: string): number {
    return this.inFlight.get(this.key(connection)) ?? 0;
  }

  tryAcquire(connection: string, limit = this.defaultLimit): boolean {
    const key = this.key(connection);
    const used = this.inFlight.get(key) ?? 0;
    const cap = Math.max(1, limit);
    if (used >= cap) return false;
    this.inFlight.set(key, used + 1);
    return true;
  }

  release(connection: string): void {
    const key = this.key(connection);
    const used = this.inFlight.get(key) ?? 0;
    if (used <= 1) this.inFlight.delete(key);
    else this.inFlight.set(key, used - 1);
    const idx = this.waiters.findIndex((waiter) => waiter.connection === key);
    if (idx >= 0) {
      const [waiter] = this.waiters.splice(idx, 1);
      waiter?.resolve();
    }
  }

  waitFor(connection: string): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({ connection: this.key(connection), resolve });
    });
  }

  private key(connection: string): string {
    return connection.trim() || 'default';
  }
}
