import { expect, test } from 'bun:test';
import { waitForBridgeReply } from './bridge-wait';

test('registers before dispatch and ignores late results after cancellation', async () => {
  const pending = new Map<string, { resolve: (value: string) => void }>();
  const controller = new AbortController();
  let oldReply: ((value: string) => void) | undefined;
  const result = waitForBridgeReply(pending, 'old', { signal: controller.signal, interrupted: 'unknown' }, () => {
    oldReply = pending.get('old')!.resolve;
  });
  controller.abort();
  expect(await result).toBe('unknown');
  expect(pending.size).toBe(0);
  const next = waitForBridgeReply(pending, 'new', { interrupted: 'unknown' }, () => {});
  oldReply!('stale success');
  expect(pending.has('new')).toBe(true);
  pending.get('new')!.resolve('fresh success');
  expect(await next).toBe('fresh success');
  expect(pending.size).toBe(0);
});

test('lost execution reply is bounded and stops before the caller can continue', async () => {
  const pending = new Map<string, { resolve: (value: string) => void }>();
  let stopped = false;
  const result = await waitForBridgeReply(pending, 'missing', {
    interrupted: 'unknown', timedOut: 'deadline; unknown', timeoutMs: 10, onTimeout: () => { stopped = true; },
  }, () => {});
  expect(result).toContain('unknown');
  expect(stopped).toBe(true);
  expect(pending.size).toBe(0);
});

test('permission waits are cancellable but have no execution deadline; channel close releases all waits', async () => {
  const pending = new Map<string, { resolve: (value: string) => void }>();
  const wait = waitForBridgeReply(pending, 'approval', { interrupted: 'blocked' }, () => {});
  await Bun.sleep(20);
  expect(pending.has('approval')).toBe(true);
  for (const item of pending.values()) item.resolve('closed');
  expect(await wait).toBe('closed');
  expect(pending.size).toBe(0);
});

test('already aborted calls never dispatch and transport write failures remove pending requests', async () => {
  const pending = new Map<string, { resolve: (value: string) => void }>();
  expect(await waitForBridgeReply(pending, 'abort', { signal: AbortSignal.abort(), interrupted: 'blocked' }, () => { throw new Error('must not dispatch'); })).toBe('blocked');
  await expect(waitForBridgeReply(pending, 'broken', { interrupted: 'unknown' }, () => { throw new Error('closed pipe'); })).rejects.toThrow('closed pipe');
  expect(pending.size).toBe(0);
});
