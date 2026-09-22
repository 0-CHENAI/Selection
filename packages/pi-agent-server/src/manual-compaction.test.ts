import { expect, it } from 'bun:test';
import { runManualCompaction } from './manual-compaction';

it('reserves before the SDK announces compaction and releases after success', async () => {
  let release!: () => void;
  let calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const session = { isCompacting: false, compact: async () => { calls++; await gate; return 'summary'; } };
  const first = runManualCompaction(session);
  await expect(runManualCompaction(session)).rejects.toThrow('already pending');
  release();
  expect(await first).toBe('summary');
  expect(calls).toBe(1);
  expect(await runManualCompaction(session)).toBe('summary');
});
it('releases the reservation after failure and keeps separate sessions independent', async () => {
  const failed = { isCompacting: false, compact: async () => { throw new Error('provider unavailable'); } };
  await expect(runManualCompaction(failed)).rejects.toThrow('provider unavailable');
  await expect(runManualCompaction(failed)).rejects.toThrow('provider unavailable');
  const next = { isCompacting: false, compact: async (instructions?: string) => instructions };
  expect(await runManualCompaction(next, 'Keep constraints')).toBe('Keep constraints');
});
