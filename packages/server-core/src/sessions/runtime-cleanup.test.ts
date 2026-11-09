import { expect, it } from 'bun:test';
import { waitForRuntimeCleanup } from './runtime-cleanup.ts';
it('bounds a nonresponsive close without claiming the resource stopped', async () => {
  await expect(waitForRuntimeCleanup(new Promise(() => {}), 'MCP', 15)).rejects.toThrow('shutdown is unconfirmed');
});
it('preserves real cleanup failures and successful results', async () => {
  await expect(waitForRuntimeCleanup(Promise.reject(new Error('closed failed')), 'MCP')).rejects.toThrow('closed failed');
  expect(await waitForRuntimeCleanup(Promise.resolve('closed'), 'MCP')).toBe('closed');
});
