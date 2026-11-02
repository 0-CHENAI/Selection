import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent';

// Exercise the actual installed SDK's exit/close probe, not a simulated process.
test('native Bash completes on exit, preserves failures and permits silent work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bash-complete-'));
  const tool = createBashToolDefinition(dir);
  const execute = (command: string, signal?: AbortSignal, timeout?: number) => tool.execute('test', { command, timeout }, signal, undefined, undefined as never);
  try {
    const silent = await execute('sleep 0.1; printf finished');
    expect(JSON.stringify(silent.content)).toContain('finished');
    // A child holding inherited stdout must not keep a completed shell waiting.
    const start = Date.now();
    const result = await execute('(sleep 2) & printf parent-finished');
    expect(JSON.stringify(result.content)).toContain('parent-finished');
    expect(Date.now() - start).toBeLessThan(1500);
    const failed = await execute('printf failed >&2; exit 7');
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ exit_code: 7 });
    const abort = new AbortController();
    const work = execute('sleep 30', abort.signal);
    setTimeout(() => abort.abort(), 30);
    await expect(work).rejects.toThrow();
    await expect(execute('sleep 30', undefined, 0.05)).rejects.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
