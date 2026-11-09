import { expect, test } from 'bun:test';
import type { SessionToolContext } from '../context';
import { TaskHelpSchema, handleTaskHelp } from './task-help';

test('structured help validates attempted work and replies before invoking the host', async () => {
  let calls = 0;
  const context = { taskHelp: async () => { calls++; return { state: 'answered', permissionGranted: false }; } } as unknown as SessionToolContext;
  expect((await handleTaskHelp(context, { action: 'request', requestId: 'r' })).isError).toBe(true);
  expect((await handleTaskHelp(context, { action: 'answer', requestId: 'r', response: 'yes' })).isError).toBe(true);
  expect(calls).toBe(0);
  const input = TaskHelpSchema.parse({ action: 'request', requestId: 'r', problem: 'Scope absent', tried: ['Read original'], needed: 'Clarify scope' });
  expect((await handleTaskHelp(context, input)).content[0]?.text).toContain('permissionGranted');
  expect(calls).toBe(1);
  const refused = { taskHelp: async () => { throw new Error('Retired attempt'); } } as unknown as SessionToolContext;
  expect((await handleTaskHelp(refused, input)).content[0]?.text).toContain('Retired attempt');
});
