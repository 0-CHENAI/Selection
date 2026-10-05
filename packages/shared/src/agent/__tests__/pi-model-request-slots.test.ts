import { expect, test } from 'bun:test';
import { PiAgent } from '../pi-agent';
import type { BackendConfig } from '../backend/types';

function fixture(limiter: NonNullable<BackendConfig['modelRequestLimiter']>) {
  const agent = new PiAgent({ provider: 'pi', isHeadless: true, skipConfigWatcher: true,
    workspace: { id: 'ws', rootPath: '/tmp', name: 'Quota test' },
    session: { id: 'worker', executionRootSessionId: 'root', parentSessionId: 'root' }, modelRequestLimiter: limiter,
  } as BackendConfig);
  const internal = agent as any, messages: unknown[] = [];
  internal.subprocess = {}; internal.modelQuota = 'host-derived-quota'; internal.send = (message: unknown) => messages.push(message);
  return { internal, messages, cleanup() { internal.subprocess = null; agent.destroy(); } };
}

test('A8 ignores model-provided quota/owner and fences a delayed grant from a replaced subprocess', async () => {
  let grant!: () => void, released = 0; const calls: string[] = [];
  const f = fixture((quota, owner) => { calls.push(`${quota}/${owner}`); return new Promise(resolve => { grant = () => resolve({ release: () => released++ }); }); });
  try {
    const pending = f.internal.acquireModelRequest('request-1');
    f.internal.subprocess = {}; grant(); await pending;
    expect(calls).toEqual(['host-derived-quota/ws/root']);
    expect(f.messages).toEqual([]); expect(released).toBe(1);
    f.internal.cancelModelRequests();
  } finally { f.cleanup(); }
});

test('A8 child teardown aborts queued grants and releases active leases without accepting stale duplicate release', async () => {
  let released = 0, queuedSignal!: AbortSignal, reject!: (error: Error) => void, calls = 0;
  const f = fixture(async (_quota, _owner, signal) => {
    if (++calls === 1) return { release: () => released++ };
    queuedSignal = signal!;
    return new Promise((_resolve, no) => { reject = no; });
  });
  try {
    await f.internal.acquireModelRequest('active'); const pending = f.internal.acquireModelRequest('queued');
    f.internal.cancelModelRequests(); reject(new Error('cancelled')); await pending;
    expect(queuedSignal.aborted).toBe(true); expect(released).toBe(1);
    f.internal.handleLine(JSON.stringify({ type: 'model_request_release', requestId: 'active', status: 429 }));
    expect(released).toBe(1);
    expect(f.internal.modelRequests.size).toBe(0);
  } finally { f.cleanup(); }
});
