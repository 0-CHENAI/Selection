import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactToolResult } from './compact-tool-result';

test('large Bash errors bypass model summarization and retain the complete result envelope', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-tool-'));
  try {
    let calls = 0;
    const content = 'started\n' + 'output '.repeat(9000) + '\nCommand exited with code 7';
    const image = { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' };
    const original = { content: [{ type: 'text' as const, text: content }, image],
      isError: true, structuredContent: { exit_code: 7 }, details: { selectionExecutionOutcome: 'unknown' } };
    const result = await compactToolResult(original, { toolName: 'Bash', sessionPath: dir, input: {},
      summarize: async () => { calls++; return 'summary'; } });
    expect(calls).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ exit_code: 7 });
    expect(result.details).toEqual(original.details);
    expect(result.content).toContainEqual(image);
    expect(JSON.stringify(result.content)).toContain('Command exited with code 7');
    expect(JSON.stringify(result.content).length).toBeLessThan(3200);
    const files = readdirSync(join(dir, 'long_responses'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dir, 'long_responses', files[0]!), 'utf8')).toBe(content);
    const other = await compactToolResult(original, { toolName: 'Read', sessionPath: dir, input: {},
      summarize: async () => { calls++; return 'requested summary'; } });
    expect(calls).toBe(1);
    expect(other.isError).toBe(true);
    expect(JSON.stringify(other.content)).toContain('requested summary');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('compaction removes original-read proof while bounded original reads keep it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-source-'));
  try {
    const proof = { path: '/original.txt', contentHash: 'hash', startLine: 1, endLine: 1, returnedTextHash: 'original' };
    const original = { content: [{ type: 'text' as const, text: 'source '.repeat(10000) }],
      details: { sourceRead: proof, selectionExecutionOutcome: 'completed' } };
    const options = { toolName: 'Read', sessionPath: dir, input: {}, summarize: async () => 'summary' };
    const compacted = await compactToolResult(original, options);
    expect(compacted.details.sourceRead).toBeUndefined();
    expect(compacted.details.selectionExecutionOutcome).toBe('completed');
    expect(original.details.sourceRead).toBe(proof);
    const bounded = { ...original, content: [{ type: 'text' as const, text: 'one original line' }] };
    expect(await compactToolResult(bounded, options)).toBe(bounded);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
