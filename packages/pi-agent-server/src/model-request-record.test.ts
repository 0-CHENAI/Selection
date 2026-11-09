import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendModelRequestRecord, modelRequestRecord } from './model-request-record';
import { beginModelRequestQueue, beginRequestDiagnostic, createRequestDiagnosticScope, runWithRequestDiagnostics } from '../../shared/src/request-diagnostics';

const context = { messages: 4, estimatedInputTokens: 120000, systemFingerprint: 'SECRET SYSTEM', toolsFingerprint: 'SECRET TOOL SCHEMA' };
test('successful slow requests retain timings and usage without bodies or secrets; logs rotate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'request-record-'));
  try {
    const scope = createRequestDiagnosticScope(), started = Date.now();
    await runWithRequestDiagnostics(scope, async () => {
      const dequeue = beginModelRequestQueue();
      await Bun.sleep(5); dequeue(); dequeue();
      const diagnostic = beginRequestDiagnostic();
      diagnostic({ phase: 'first-bytes', httpStatus: 200, requestId: 'Bearer secret token' });
      diagnostic({ phase: 'first-output' });
      diagnostic({ phase: 'done', secret: 'SECRET BODY' });
    });
    const record = modelRequestRecord(scope, started, 'success', context, { input: 97386, output: 7361, cacheRead: 22528, cacheWrite: 0 });
    expect(record.queueMs).toBeGreaterThan(0);
    expect(record.firstByteMs).toBeDefined();
    expect(record.firstOutputMs).toBeDefined();
    expect(record).toMatchObject({ outcome: 'success', outputTokens: 7361, cacheReadTokens: 22528 });
    appendModelRequestRecord(dir, record);
    const file = join(dir, 'diagnostics/model-requests.jsonl');
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('SECRET'); expect(text).not.toContain('Bearer');
    expect(record.systemFingerprint).toHaveLength(64);
    writeFileSync(file, 'x'.repeat(1024 * 1024));
    appendModelRequestRecord(dir, record);
    expect(statSync(file + '.1').size).toBe(1024 * 1024);
    expect(statSync(file).size).toBeLessThan(4096);
    appendModelRequestRecord(join(dir, 'diagnostics/model-requests.jsonl'), record); // bad directory must not throw
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('error and cancelled records keep only known measurements', () => {
  for (const outcome of ['error', 'cancelled'] as const) {
    const record = modelRequestRecord(createRequestDiagnosticScope(), Date.now(), outcome, context);
    expect(record.outcome).toBe(outcome);
    expect(record.firstOutputMs).toBeUndefined();
    expect(record.inputTokens).toBeUndefined();
  }
});

test('diagnostic preparation is lazy and isolated from execution failures', () => {
  let calls = 0;
  appendModelRequestRecord(undefined, () => { calls++; throw new Error('must not calculate unused fingerprints'); });
  expect(calls).toBe(0);
  const dir = mkdtempSync(join(tmpdir(), 'request-record-failed-'));
  try {
    expect(() => appendModelRequestRecord(dir, () => { throw new Error('metadata serialization failed'); })).not.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
