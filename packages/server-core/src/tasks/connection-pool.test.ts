import { describe, expect, it } from 'bun:test';
import { LlmConnectionPool, retryAfterMs } from './connection-pool';
import { modelQuotaIdentity } from '../../../shared/src/agent/backend/pi/model-quota';

describe('LlmConnectionPool', () => {
  it('tightens concurrency per connection and releases capacity after failure', () => {
    const pool = new LlmConnectionPool(2);
    expect(pool.tryAcquire('alpha', 2)).toBe(true);
    expect(pool.tryAcquire('alpha', 2)).toBe(true);
    expect(pool.tryAcquire('alpha', 2)).toBe(false);
    expect(pool.tryAcquire('beta', 2)).toBe(true);
    pool.release('alpha');
    expect(pool.tryAcquire('alpha', 2)).toBe(true);
  });
});

it('A8 groups identical credentials/endpoints across connection names, isolates distinct keys, and keeps OAuth rotation stable', () => {
  const key = { type: 'api_key', key: 'private-test-key' };
  const identity = modelQuotaIdentity('openai-responses', 'https://api.example/v1/', key);
  expect(identity).toBe(modelQuotaIdentity('openai', 'https://api.example/v1/responses', key));
  expect(identity).not.toBe(modelQuotaIdentity('openai', 'https://api.example/v1', { ...key, key: 'another-key' }));
  expect(identity).not.toContain(key.key);
  const oauth = (token: string) => ({ type: 'oauth', access: `header.${Buffer.from(JSON.stringify({ sub: 'same-account', token })).toString('base64url')}.sig`, refresh: token });
  expect(modelQuotaIdentity('openai-codex', undefined, oauth('old'))).toBe(modelQuotaIdentity('openai-codex', undefined, oauth('new')));
});

it('A8 fairly rotates runs rather than letting one run consume its whole queue', async () => {
  const pool = new LlmConnectionPool(1), first = await pool.acquireRequest('shared', 'run-a');
  const order: string[] = [];
  const a = pool.acquireRequest('shared', 'run-a').then(lease => { order.push('a'); return lease; });
  const a2 = pool.acquireRequest('shared', 'run-a').then(lease => { order.push('a2'); return lease; });
  const b = pool.acquireRequest('shared', 'run-b').then(lease => { order.push('b'); return lease; });
  first.release(); (await b).release(); (await a).release(); (await a2).release();
  expect(order).toEqual(['b', 'a', 'a2']);
  expect(pool.requestState('shared').active).toBe(0);
});

it('A8 cancellation removes waiting requests and returns active slots once, including late duplicate release', async () => {
  const pool = new LlmConnectionPool(1), active = new AbortController(), waiting = new AbortController();
  const lease = await pool.acquireRequest('quota', 'a', active.signal);
  const cancelled = pool.acquireRequest('quota', 'b', waiting.signal).catch(error => error);
  waiting.abort(); await cancelled;
  expect(pool.requestState('quota').queued).toBe(0);
  const next = pool.acquireRequest('quota', 'c'); active.abort();
  const granted = await next;
  lease.release({ status: 429, retryAfter: '600' });
  expect(pool.requestState('quota')).toMatchObject({ active: 1, retryAt: 0 });
  granted.release();
});

it('A8 releases a throttled request before Retry-After, reduces the cap, and recovers gradually', async () => {
  const pool = new LlmConnectionPool(4);
  const active = await Promise.all([0, 1, 2, 3].map(n => pool.acquireRequest('quota', `run-${n}`)));
  active[0]!.release({ status: 429, retryAfter: '0.03' });
  for (const lease of active.slice(1)) lease.release();
  expect(pool.requestState('quota')).toMatchObject({ active: 0, cap: 2 });
  let granted = false;
  const next = pool.acquireRequest('quota', 'other').then(lease => { granted = true; return lease; });
  await new Promise(resolve => setTimeout(resolve, 5)); expect(granted).toBe(false);
  const lease = await next; lease.release({ status: 200 });
  (await pool.acquireRequest('quota', 'other')).release({ status: 200 });
  expect(pool.requestState('quota')).toMatchObject({ active: 0, cap: 3 });
  expect(retryAfterMs('Mon, 05 Oct 2026 09:00:10 GMT', Date.parse('2026-10-05T09:00:00Z'))).toBe(10_000);
  expect(retryAfterMs('invalid')).toBeUndefined();
});

it('resumes Retry-After in a standalone process with no other active handles', async () => {
  const code = `
    import { LlmConnectionPool } from ${JSON.stringify(new URL('./connection-pool.ts', import.meta.url).href)};
    const pool = new LlmConnectionPool(1);
    (await pool.acquireRequest('quota', 'first')).release({ status: 429, retryAfter: '0.03' });
    (await pool.acquireRequest('quota', 'next')).release();
    console.log('resumed');
  `;
  const child = Bun.spawn([process.execPath, '--eval', code], { stdout: 'pipe', stderr: 'pipe' });
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit, stderr).toBe(0);
    expect(stdout.trim()).toBe('resumed');
  } finally { clearTimeout(timeout); child.kill(); }
}, 10000);

it('isolates old batch failures and successes while honoring late Retry-After', async () => {
  const pool = new LlmConnectionPool(4);
  const batch = await Promise.all([0, 1, 2, 3].map(n => pool.acquireRequest('quota', `run-${n}`)));
  batch[0]!.release({ status: 429, retryAfter: '0' });
  expect(pool.requestState('quota').cap).toBe(2);
  batch[1]!.release({ status: 503, retryAfter: '0.03' });
  expect(pool.requestState('quota').cap).toBe(2);
  expect(pool.requestState('quota').retryAt).toBeGreaterThan(Date.now());
  batch[2]!.release({ status: 200 }); batch[3]!.release({ status: 200 });
  expect(pool.requestState('quota')).toMatchObject({ active: 0, cap: 2, queued: 0 });
  let granted = false;
  const waiting = pool.acquireRequest('quota', 'next').then(lease => { granted = true; return lease; });
  await new Promise(resolve => setTimeout(resolve, 5)); expect(granted).toBe(false);
  (await waiting).release({ status: 200 });
  expect(pool.requestState('quota').cap).toBe(2);
  const recovering = await pool.acquireRequest('quota', 'next');
  const oldProbe = await pool.acquireRequest('quota', 'next');
  recovering.release({ status: 200 });
  expect(pool.requestState('quota').cap).toBe(3);
  oldProbe.release({ status: 200 });
  const next = await Promise.all([0, 1].map(() => pool.acquireRequest('quota', 'next')));
  next.forEach(lease => lease.release({ status: 200 }));
  expect(pool.requestState('quota').cap).toBe(3);
  (await pool.acquireRequest('quota', 'next')).release({ status: 200 });
  expect(pool.requestState('quota')).toMatchObject({ active: 0, cap: 4, queued: 0 });
});

it('a new admission epoch can throttle again and duplicate release stays harmless', async () => {
  const pool = new LlmConnectionPool(4);
  const first = await pool.acquireRequest('quota', 'a');
  first.release({ status: 429, retryAfter: '0' });
  const second = await pool.acquireRequest('quota', 'a');
  second.release({ status: 503, retryAfter: '0' });
  first.release({ status: 429, retryAfter: '600' });
  expect(pool.requestState('quota')).toMatchObject({ active: 0, cap: 1, queued: 0 });
  expect(pool.requestState('quota').retryAt).toBeLessThanOrEqual(Date.now());
});

it('late throttling retains the minimum cooldown after fresh success resets backoff', async () => {
  const pool = new LlmConnectionPool(4);
  const batch = await Promise.all([0, 1, 2, 3].map(() => pool.acquireRequest('quota', 'a')));
  batch[0]!.release({ status: 429, retryAfter: '0' });
  batch[1]!.release(); batch[2]!.release();
  (await pool.acquireRequest('quota', 'b')).release({ status: 200 });
  const now = Date.now();
  batch[3]!.release({ status: 429 });
  expect(pool.requestState('quota')).toMatchObject({ cap: 2, active: 0, queued: 0 });
  expect(pool.requestState('quota').retryAt).toBeGreaterThanOrEqual(now + 1000);
});
