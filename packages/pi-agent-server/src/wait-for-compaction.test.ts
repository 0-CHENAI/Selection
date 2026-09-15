import { expect, it } from 'bun:test';
import { waitForCompaction } from './wait-for-compaction.ts';

it('does not launch another model request when compaction fails to settle', async () => {
  let calls = 0;
  await expect((async () => {
    await waitForCompaction({ isCompacting: true }, 15, 5);
    calls++;
  })()).rejects.toThrow('refusing');
  expect(calls).toBe(0);
});
it('resumes only after compaction is actually finished', async () => {
  const session = { isCompacting: true };
  const pending = waitForCompaction(session, 100, 5);
  session.isCompacting = false;
  await pending;
});
