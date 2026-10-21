/**
 * Observe-only calibration of the local context estimate.
 *
 * After each assistant response the provider prompt
 * (input + cacheRead + cacheWrite) is compared with the local estimate of
 * that same prompt. The ratio is tracked as a per-model exponential moving
 * average and persisted per connection. Callers apply it later; recording a
 * sample does not change compaction by itself.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../../../config/paths.ts';
import { debug } from '../../../utils/debug.ts';
import { atomicWriteFileSync, readJsonFileSync } from '../../../utils/files.ts';

export const CONTEXT_METER_EMA_ALPHA = 0.2;
/**
 * A provider/local ratio outside this band did not measure the same prompt
 * (placeholder usage, or a context the provider never billed). Training on it
 * would shrink later estimates and skip compaction. Real tokenizer bias,
 * including image-formula error within 4×, still moves the average.
 */
export const CONTEXT_METER_MAX_RATIO = 4;
const METER_FILE = 'context-token-meters.json';

export interface ContextMeterSample {
  ema: number;
  samples: number;
  updatedAt: number;
}

interface MeterFile {
  connections: Record<string, { models: Record<string, ContextMeterSample> }>;
}

const memory = new Map<string, ContextMeterSample>();
let directoryOverride: string | undefined;

export function setContextMeterDirectory(directory: string | undefined): void {
  directoryOverride = directory;
  memory.clear();
}

export function contextMeterKey(connectionKey: string, modelKey: string): string {
  return `${connectionKey}\0${modelKey}`;
}

function meterDirectory(): string {
  return directoryOverride ?? CONFIG_DIR;
}

function meterPath(): string {
  return join(meterDirectory(), METER_FILE);
}

function emptyFile(): MeterFile {
  return { connections: {} };
}

function readFile(): MeterFile {
  try {
    const parsed = readJsonFileSync<MeterFile>(meterPath());
    if (!parsed || typeof parsed !== 'object' || !parsed.connections || typeof parsed.connections !== 'object') {
      return emptyFile();
    }
    return parsed;
  } catch {
    return emptyFile();
  }
}

function writeFile(file: MeterFile): void {
  const directory = meterDirectory();
  mkdirSync(directory, { recursive: true });
  atomicWriteFileSync(meterPath(), JSON.stringify(file));
}

function isSample(value: unknown): value is ContextMeterSample {
  if (!value || typeof value !== 'object') return false;
  const sample = value as ContextMeterSample;
  return Number.isFinite(sample.ema) && sample.ema > 0
    && Number.isFinite(sample.samples) && sample.samples >= 0;
}

export function loadContextMeter(connectionKey: string, modelKey: string): ContextMeterSample | undefined {
  const key = contextMeterKey(connectionKey, modelKey);
  const cached = memory.get(key);
  if (cached) return cached;
  const stored = readFile().connections[connectionKey]?.models?.[modelKey];
  if (!isSample(stored)) return undefined;
  memory.set(key, stored);
  return stored;
}

export function contextMeterRatio(connectionKey: string, modelKey: string): number {
  return loadContextMeter(connectionKey, modelKey)?.ema ?? 1;
}

export function nextContextMeter(previous: ContextMeterSample | undefined, ratio: number, now = Date.now()): ContextMeterSample {
  if (!previous || previous.samples <= 0) {
    return { ema: ratio, samples: 1, updatedAt: now };
  }
  return {
    ema: CONTEXT_METER_EMA_ALPHA * ratio + (1 - CONTEXT_METER_EMA_ALPHA) * previous.ema,
    samples: previous.samples + 1,
    updatedAt: now,
  };
}

export interface ContextMeterObservation {
  ratio: number;
  ema: number;
  samples: number;
  providerTokens: number;
  localTokens: number;
}

/**
 * Record one provider/local ratio. Returns undefined when the sample cannot
 * be used (non-positive or non-finite). Persists under connection + model.
 */
export function observeContextMeter(
  connectionKey: string,
  modelKey: string,
  providerTokens: number,
  localTokens: number,
  now = Date.now(),
): ContextMeterObservation | undefined {
  if (!Number.isFinite(providerTokens) || providerTokens <= 0) return undefined;
  if (!Number.isFinite(localTokens) || localTokens <= 0) return undefined;
  const ratio = providerTokens / localTokens;
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  if (ratio < 1 / CONTEXT_METER_MAX_RATIO || ratio > CONTEXT_METER_MAX_RATIO) {
    debug(
      `[context-meter] skip ${connectionKey || '(no-connection)'}/${modelKey} `
      + `provider=${Math.round(providerTokens)} local=${Math.round(localTokens)} `
      + `ratio=${ratio.toFixed(3)} outside 1/${CONTEXT_METER_MAX_RATIO}..${CONTEXT_METER_MAX_RATIO}`,
    );
    return undefined;
  }
  const next = nextContextMeter(loadContextMeter(connectionKey, modelKey), ratio, now);
  const key = contextMeterKey(connectionKey, modelKey);
  memory.set(key, next);
  try {
    const file = readFile();
    const connection = file.connections[connectionKey] ?? { models: {} };
    connection.models[modelKey] = next;
    file.connections[connectionKey] = connection;
    writeFile(file);
  } catch (error) {
    debug('[context-meter] persist failed', error instanceof Error ? error.message : error);
  }
  debug(
    `[context-meter] ${connectionKey || '(no-connection)'}/${modelKey} `
    + `provider=${Math.round(providerTokens)} local=${Math.round(localTokens)} `
    + `ratio=${ratio.toFixed(3)} ema=${next.ema.toFixed(3)} samples=${next.samples}`,
  );
  return {
    ratio,
    ema: next.ema,
    samples: next.samples,
    providerTokens,
    localTokens,
  };
}

/** Latest context_edit or compaction id. A change invalidates a usage anchor. */
export function contextBranchRevision(entries: ReadonlyArray<{ type?: string; id?: string }> | undefined): string {
  let latest = '';
  for (const entry of entries ?? []) {
    if (entry?.type === 'context_edit' || entry?.type === 'compaction') {
      latest = `${entry.type}:${entry.id ?? ''}`;
    }
  }
  return latest;
}
