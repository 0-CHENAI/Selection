import { expect, it } from 'bun:test';
import { QueryCancellation } from './query-cancellation';

it('invalidates initialization and aborts each active session despite individual failures', async () => {
  const registry = new QueryCancellation();
  const epoch = registry.snapshot();
  const calls: string[] = [];
  const failure = new Error('abort failed');
  registry.attach(epoch, { async abort() { calls.push('one'); throw failure; } });
  registry.attach(epoch, { async abort() { calls.push('two'); } });
  expect(await registry.abort()).toEqual([failure]);
  expect(calls).toEqual(['one', 'two']);
  expect(() => registry.assertActive(epoch)).toThrow('cancelled');
  expect(() => registry.attach(epoch, { async abort() {} })).toThrow('cancelled');
});

it('releases completed sessions and permits explicitly started new requests after cancellation', async () => {
  const registry = new QueryCancellation();
  let calls = 0;
  const session = { async abort() { calls++; } };
  registry.attach(registry.snapshot(), session);
  registry.release(session);
  await registry.abort();
  expect(calls).toBe(0);
  registry.attach(registry.snapshot(), session);
  await registry.abort();
  expect(calls).toBe(1);
});
