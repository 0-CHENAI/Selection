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
it('restores settings after the prior compaction settles and before manual preparation', async () => {
  const steps: string[] = [];
  let compacting = true;
  const session = {
    get isCompacting() { return compacting; },
    compact: async () => { steps.push('compact'); return 'summary'; },
  };
  const pending = runManualCompaction(session, undefined, () => { steps.push('restore settings'); });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(steps).toEqual([]);
  compacting = false;
  expect(await pending).toBe('summary');
  expect(steps).toEqual(['restore settings', 'compact']);
});

it('blocks a model request while manual compaction has reserved but not entered SDK compact', async () => {
  const { waitForCompaction } = await import('./wait-for-compaction')
  let release!: () => void
  const session = { isCompacting: false, compact: () => new Promise<void>(resolve => { release = resolve }) }
  const compacting = runManualCompaction(session)
  await Promise.resolve()
  await expect(waitForCompaction(session, 5, 1)).rejects.toThrow('Compaction is still running')
  release()
  await compacting
  await waitForCompaction(session, 5, 1)
})

it('a repeated release from an old compaction cannot unlock its successor', async () => {
  const { reserveCompaction, hasCompactionReservation } = await import('./compaction-reservation')
  const session = {}
  const first = reserveCompaction(session)
  first()
  const second = reserveCompaction(session)
  first()
  expect(hasCompactionReservation(session)).toBe(true)
  expect(() => reserveCompaction(session)).toThrow('already pending')
  second()
  expect(hasCompactionReservation(session)).toBe(false)
})

it('cancelled queued manual compaction never starts and releases its reservation', async () => {
  const { hasCompactionReservation } = await import('./compaction-reservation')
  const controller = new AbortController()
  let calls = 0
  const session = { isCompacting: true, compact: async () => { calls++; return 'summary' } }
  const waiting = runManualCompaction(session, undefined, undefined, controller.signal)
  controller.abort(); session.isCompacting = false
  await expect(waiting).rejects.toThrow()
  expect(calls).toBe(0)
  expect(hasCompactionReservation(session)).toBe(false)
  expect(await runManualCompaction(session)).toBe('summary')
})
