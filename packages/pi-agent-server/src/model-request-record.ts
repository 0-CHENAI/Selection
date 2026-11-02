import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestDiagnosticScope } from '../../shared/src/request-diagnostics.ts';

/** Metadata only: never serialize prompts, headers, tool inputs or error messages. */
export interface ModelRequestRecord {
  invocationId: string;
  at: number;
  elapsedMs: number;
  queueMs: number;
  outcome: 'success' | 'error' | 'cancelled';
  attempts: number;
  messages: number;
  estimatedInputTokens: number;
  systemFingerprint: string;
  toolsFingerprint: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  firstByteMs?: number;
  firstEventMs?: number;
  firstOutputMs?: number;
  httpStatus?: number;
}

export function modelRequestRecord(
  scope: RequestDiagnosticScope,
  startedAt: number,
  outcome: ModelRequestRecord['outcome'],
  context: Pick<ModelRequestRecord, 'messages' | 'estimatedInputTokens' | 'systemFingerprint' | 'toolsFingerprint'>,
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number },
): ModelRequestRecord {
  const diagnostic = scope.latest;
  return {
    messages: context.messages, estimatedInputTokens: context.estimatedInputTokens,
    systemFingerprint: createHash('sha256').update(context.systemFingerprint).digest('hex'),
    toolsFingerprint: createHash('sha256').update(context.toolsFingerprint).digest('hex'),
    invocationId: scope.invocationId, at: Date.now(),
    elapsedMs: Math.max(0, Date.now() - startedAt), queueMs: (scope.queueMs ?? 0) + (scope.queueStartedAt === undefined ? 0 : Math.max(0, Date.now() - scope.queueStartedAt)),
    outcome, attempts: scope.attempts,
    inputTokens: usage?.input, outputTokens: usage?.output,
    cacheReadTokens: usage?.cacheRead, cacheWriteTokens: usage?.cacheWrite,
    // Timings below describe the latest HTTP attempt, not the whole invocation.
    firstByteMs: diagnostic?.firstByteMs, firstEventMs: diagnostic?.firstEventMs,
    firstOutputMs: diagnostic?.firstOutputMs, httpStatus: diagnostic?.httpStatus,
  };
}

/** Two bounded files per SDK session; diagnostics must never break execution. */
export function appendModelRequestRecord(sessionDir: string | undefined, record: ModelRequestRecord | (() => ModelRequestRecord)): void {
  if (!sessionDir) return;
  try {
    const dir = join(sessionDir, 'diagnostics');
    const file = join(dir, 'model-requests.jsonl');
    const line = JSON.stringify(typeof record === 'function' ? record() : record) + '\n';
    if (Buffer.byteLength(line) > 4096) return;
    mkdirSync(dir, { recursive: true });
    let size = 0;
    try { size = statSync(file).size; } catch { /* first request */ }
    if (size + Buffer.byteLength(line) > 1024 * 1024) renameSync(file, file + '.1');
    appendFileSync(file, line, { mode: 0o600 });
  } catch { /* best effort; no model or filesystem content goes to the UI */ }
}
