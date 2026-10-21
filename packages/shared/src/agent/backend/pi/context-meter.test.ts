import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTEXT_METER_EMA_ALPHA,
  CONTEXT_METER_MAX_RATIO,
  contextBranchRevision,
  contextMeterRatio,
  loadContextMeter,
  nextContextMeter,
  observeContextMeter,
  setContextMeterDirectory,
} from './context-meter.ts';

describe('context token meter', () => {
  it('seeds the EMA with the first ratio and then blends', () => {
    const first = nextContextMeter(undefined, 2, 1_000);
    expect(first).toEqual({ ema: 2, samples: 1, updatedAt: 1_000 });
    const second = nextContextMeter(first, 4, 2_000);
    expect(second.samples).toBe(2);
    expect(second.ema).toBeCloseTo(CONTEXT_METER_EMA_ALPHA * 4 + (1 - CONTEXT_METER_EMA_ALPHA) * 2);
    expect(second.updatedAt).toBe(2_000);
  });

  it('persists a sample per connection and model and ignores unusable counts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'context-meter-'));
    setContextMeterDirectory(directory);
    expect(observeContextMeter('conn', 'openai/m', 0, 10)).toBeUndefined();
    expect(observeContextMeter('conn', 'openai/m', 10, 0)).toBeUndefined();
    expect(observeContextMeter('conn', 'openai/m', Number.NaN, 10)).toBeUndefined();

    const first = observeContextMeter('conn', 'openai/m', 200, 100, 5_000);
    expect(first).toMatchObject({ ratio: 2, ema: 2, samples: 1, providerTokens: 200, localTokens: 100 });
    const second = observeContextMeter('conn', 'openai/m', 100, 100, 6_000);
    expect(second?.samples).toBe(2);
    expect(second?.ema).toBeCloseTo(CONTEXT_METER_EMA_ALPHA * 1 + (1 - CONTEXT_METER_EMA_ALPHA) * 2);

    const stored = JSON.parse(readFileSync(join(directory, 'context-token-meters.json'), 'utf8'));
    expect(stored.connections.conn.models['openai/m'].samples).toBe(2);
    setContextMeterDirectory(directory);
    expect(loadContextMeter('conn', 'openai/m')?.samples).toBe(2);
    expect(contextMeterRatio('conn', 'openai/m')).toBeCloseTo(second!.ema);
    expect(contextMeterRatio('other', 'openai/m')).toBe(1);
    observeContextMeter('other', 'anthropic/m', 50, 25, 7_000);
    expect(loadContextMeter('conn', 'openai/m')?.samples).toBe(2);
    expect(loadContextMeter('other', 'anthropic/m')?.ema).toBe(2);
  });

  it('does not train on a ratio that cannot describe the same prompt', () => {
    const directory = mkdtempSync(join(tmpdir(), 'context-meter-band-'));
    setContextMeterDirectory(directory);
    expect(observeContextMeter('conn', 'openai/m', 100, 100 * CONTEXT_METER_MAX_RATIO, 1_000)?.ratio).toBeCloseTo(1 / CONTEXT_METER_MAX_RATIO);
    expect(observeContextMeter('conn', 'openai/m', 10, 10_000)).toBeUndefined();
    expect(observeContextMeter('conn', 'openai/m', 10_000, 10)).toBeUndefined();
    expect(loadContextMeter('conn', 'openai/m')?.samples).toBe(1);
  });

  it('tracks the latest context edit or compaction', () => {
    expect(contextBranchRevision(undefined)).toBe('');
    expect(contextBranchRevision([
      { type: 'message', id: 'm1' },
      { type: 'compaction', id: 'c1' },
      { type: 'message', id: 'm2' },
      { type: 'context_edit', id: 'e1' },
    ])).toBe('context_edit:e1');
  });
});
