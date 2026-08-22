/**
 * Per-user-turn OfficeCLI call budget.
 *
 * The tracker intentionally keeps only counters and opaque in-memory file keys.
 * Snapshots never expose document contents, command text, or full file paths.
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const DIRECT_MUTATION_LIMIT = 8;
const REPLAN_CALL_THRESHOLD = 20;

const OFFICECLI_TOOL_ALIASES = new Set([
  'officecli_batch',
  'officecli_qa',
  'mcp__session__officecli_batch',
  'mcp__session__officecli_qa',
]);

// Recognize both the reviewed PATH wrapper and the host-provided binary env
// variable. The latter must not be a budget bypass for direct mutations.
const OFFICECLI_EXECUTABLE_SOURCE = String.raw`(?:\bofficecli(?:-[\w-]+)?(?:\.(?:exe|cmd))?|\$(?:\{)?CRAFT_OFFICECLI(?:\})?|%CRAFT_OFFICECLI%|\$(?:\{)?env:CRAFT_OFFICECLI(?:\})?)`;
const DIRECT_MUTATION_PATTERN = new RegExp(`${OFFICECLI_EXECUTABLE_SOURCE}(?:["'])?\\s+(?:--%\\s+)?(add|set|remove|move|swap)\\b`, 'i');
const OFFICECLI_COMMAND_PATTERN = new RegExp(`${OFFICECLI_EXECUTABLE_SOURCE}(?:["'])?\\s+`, 'i');
const SHELL_BATCH_PATTERN = new RegExp(`${OFFICECLI_EXECUTABLE_SOURCE}(?:["'])?\\s+(?:--%\\s+)?batch\\b`, 'i');
const POWERSHELL_ARGUMENT_MUTATION_PATTERN = new RegExp(
  String.raw`\bStart-Process\b(?=[^\r\n]*${OFFICECLI_EXECUTABLE_SOURCE})(?=[^\r\n]*-ArgumentList\s+(?:@\(\s*)?(?:["'][^"'\r\n]*?\b)?(add|set|remove|move|swap)\b)[^\r\n]*`,
  'i',
);
const POWERSHELL_ARGUMENT_BATCH_PATTERN = new RegExp(
  String.raw`\bStart-Process\b(?=[^\r\n]*${OFFICECLI_EXECUTABLE_SOURCE})(?=[^\r\n]*-ArgumentList\s+(?:@\(\s*)?(?:["'][^"'\r\n]*?\b)?batch\b)[^\r\n]*`,
  'i',
);
const QUOTED_OFFICE_FILE_PATTERN = /["']([^"']+\.(?:docx|docm|xlsx|xlsm|pptx))["']/i;
const UNQUOTED_OFFICE_FILE_PATTERN = /(?:^|\s)([^\s"']+\.(?:docx|docm|xlsx|xlsm|pptx))(?:\s|$)/i;

/** Keep budget and latency classification aligned for every supported shell spelling. */
export function isOfficecliShellCommand(command: string): boolean {
  return OFFICECLI_COMMAND_PATTERN.test(command)
    || POWERSHELL_ARGUMENT_MUTATION_PATTERN.test(command)
    || POWERSHELL_ARGUMENT_BATCH_PATTERN.test(command);
}

export interface OfficecliExecutionSnapshot {
  attemptedToolCalls: number;
  toolCalls: number;
  batchCalls: number;
  batchOperations: number;
  batchSizes: number[];
  directMutations: number;
  qaCalls: number;
  qaModes: Record<string, number>;
  visualStatuses: Record<string, number>;
  blockedCalls: number;
  replanTriggered: boolean;
  fileCount: number;
  executionMs: number;
  errorTypes: Record<string, number>;
  failedOperationIndexes: number[];
}

export type OfficecliExecutionDecision =
  | { allowed: true }
  | { allowed: false; reason: string; kind: 'direct_mutation_limit' | 'qa_limit' | 'replan_required' | 'protocol_conflict' };

export interface OfficecliExecutionCheckpoint extends OfficecliExecutionSnapshot {
  /** In-memory continuation state only. Never log or persist this field. */
  internalDirectMutationsByFile?: Array<[string, number]>;
}

function commandFromInput(input: Record<string, unknown>): string | null {
  const value = input.command ?? input.cmd;
  return typeof value === 'string' ? value : null;
}

function fileKey(
  toolName: string,
  input: Record<string, unknown>,
  command: string | null,
  workingDirectory?: string,
): string {
  const raw = OFFICECLI_TOOL_ALIASES.has(toolName) && typeof input.file === 'string' && input.file.trim()
    ? input.file
    : command?.match(QUOTED_OFFICE_FILE_PATTERN)?.[1]
    ?? command?.match(UNQUOTED_OFFICE_FILE_PATTERN)?.[1]
    ?? '__unknown_office_file__';
  if (raw === '__unknown_office_file__') return raw;
  const leadingCd = command?.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*&&/i);
  const commandWorkingDirectory = leadingCd
    ? resolve(workingDirectory ?? process.cwd(), leadingCd[1] ?? leadingCd[2] ?? leadingCd[3]!)
    : workingDirectory ?? process.cwd();
  const absolute = resolve(commandWorkingDirectory, raw);
  let canonical = absolute;
  try {
    if (existsSync(absolute)) canonical = realpathSync.native(absolute);
  } catch {
    // The file may not exist yet (for example before create). Syntactic
    // normalization from resolve() still unifies ./ and ../ aliases.
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/**
 * Tracks OfficeCLI usage and blocks pathological serial mutation loops.
 * Call `reset()` exactly once at the start of each new user message.
 */
export class OfficecliExecutionTracker {
  private attemptedToolCalls = 0;
  private toolCalls = 0;
  private batchCalls = 0;
  private batchOperations = 0;
  private batchSizes: number[] = [];
  private directMutations = 0;
  private directMutationsByFile = new Map<string, number>();
  private qaCalls = 0;
  private qaModes = new Map<string, number>();
  private visualStatuses = new Map<string, number>();
  private blockedCalls = 0;
  private replanTriggered = false;
  private touchedFiles = new Set<string>();
  private executionMs = 0;
  private errorTypes = new Map<string, number>();
  private failedOperationIndexes = new Set<number>();
  // Pi can ask the host to authorize the same proxy tool twice (the generic
  // tool hook plus the proxy hook). Reusing the first decision makes budgets
  // idempotent without persisting tool-call IDs in telemetry.
  private decisionsByToolCallId = new Map<string, {
    signature: string;
    decision: OfficecliExecutionDecision;
  }>();

  reset(): void {
    this.attemptedToolCalls = 0;
    this.toolCalls = 0;
    this.batchCalls = 0;
    this.batchOperations = 0;
    this.batchSizes = [];
    this.directMutations = 0;
    this.directMutationsByFile.clear();
    this.qaCalls = 0;
    this.qaModes.clear();
    this.visualStatuses.clear();
    this.blockedCalls = 0;
    this.replanTriggered = false;
    this.touchedFiles.clear();
    this.executionMs = 0;
    this.errorTypes.clear();
    this.failedOperationIndexes.clear();
    this.decisionsByToolCallId.clear();
  }

  /** Restore a content-free checkpoint when an internal auth retry recreates the backend. */
  restore(snapshot: OfficecliExecutionCheckpoint): void {
    this.reset();
    this.attemptedToolCalls = Math.max(0, Math.floor(snapshot.attemptedToolCalls));
    this.toolCalls = Math.max(0, Math.floor(snapshot.toolCalls));
    this.batchCalls = Math.max(0, Math.floor(snapshot.batchCalls));
    this.batchOperations = Math.max(0, Math.floor(snapshot.batchOperations));
    this.batchSizes = snapshot.batchSizes
      .filter(size => Number.isInteger(size) && size >= 0 && size <= 50)
      .map(size => Math.floor(size));
    this.directMutations = Math.max(0, Math.floor(snapshot.directMutations));
    for (const [key, count] of snapshot.internalDirectMutationsByFile ?? []) {
      if (typeof key === 'string' && key && Number.isFinite(count)) {
        this.directMutationsByFile.set(key, Math.max(0, Math.floor(count)));
        this.touchedFiles.add(key);
      }
    }
    this.qaCalls = Math.max(0, Math.floor(snapshot.qaCalls));
    this.qaModes = new Map(Object.entries(snapshot.qaModes)
      .filter(([mode, count]) => (mode === 'balanced' || mode === 'strict') && Number.isFinite(count))
      .map(([mode, count]) => [mode, Math.max(0, Math.floor(count))]));
    this.visualStatuses = new Map(Object.entries(snapshot.visualStatuses)
      .filter(([status, count]) => (
        status === 'checked' || status === 'skipped_no_vision' || status === 'render_failed'
      ) && Number.isFinite(count))
      .map(([status, count]) => [status, Math.max(0, Math.floor(count))]));
    this.blockedCalls = Math.max(0, Math.floor(snapshot.blockedCalls));
    this.replanTriggered = snapshot.replanTriggered === true;
    const restoredFileCount = Math.max(0, Math.floor(snapshot.fileCount));
    for (let index = this.touchedFiles.size; index < restoredFileCount; index++) {
      this.touchedFiles.add(`__restored_office_file_${index}__`);
    }
    this.executionMs = Math.max(0, Math.floor(snapshot.executionMs));
    this.errorTypes = new Map(Object.entries(snapshot.errorTypes)
      .filter(([type, count]) => /^[a-z0-9_-]{1,40}$/i.test(type) && Number.isFinite(count))
      .map(([type, count]) => [type, Math.max(0, Math.floor(count))]));
    this.failedOperationIndexes = new Set(snapshot.failedOperationIndexes
      .filter(index => Number.isInteger(index) && index >= 0 && index < 50));
  }

  recordExecution(
    durationMs: number,
    details?: { errorType?: string; failedIndex?: number; qaMode?: string; visualStatus?: string },
  ): void {
    if (Number.isFinite(durationMs) && durationMs > 0) {
      this.executionMs += Math.round(durationMs);
    }
    const errorType = details?.errorType;
    if (typeof errorType === 'string' && /^[a-z0-9_-]{1,40}$/i.test(errorType)) {
      this.errorTypes.set(errorType, (this.errorTypes.get(errorType) ?? 0) + 1);
    }
    const failedIndex = details?.failedIndex;
    if (typeof failedIndex === 'number' && Number.isInteger(failedIndex) && failedIndex >= 0 && failedIndex < 50) {
      this.failedOperationIndexes.add(failedIndex);
    }
    if (details?.qaMode === 'balanced' || details?.qaMode === 'strict') {
      this.qaModes.set(details.qaMode, (this.qaModes.get(details.qaMode) ?? 0) + 1);
    }
    if (
      details?.visualStatus === 'checked' ||
      details?.visualStatus === 'skipped_no_vision' ||
      details?.visualStatus === 'render_failed'
    ) {
      this.visualStatuses.set(
        details.visualStatus,
        (this.visualStatuses.get(details.visualStatus) ?? 0) + 1,
      );
    }
  }

  inspect(
    toolName: string,
    input: Record<string, unknown>,
    toolCallId?: string,
    workingDirectory?: string,
  ): OfficecliExecutionDecision {
    const command = commandFromInput(input);
    const isTypedBatch = toolName === 'officecli_batch' || toolName === 'mcp__session__officecli_batch';
    const isQa = toolName === 'officecli_qa' || toolName === 'mcp__session__officecli_qa';
    const isOfficeBash = toolName === 'Bash' && command !== null && isOfficecliShellCommand(command);

    if (!isTypedBatch && !isQa && !isOfficeBash) return { allowed: true };

    const key = fileKey(toolName, input, command, workingDirectory);
    const directVerb = command?.match(DIRECT_MUTATION_PATTERN)?.[1]
      ?? command?.match(POWERSHELL_ARGUMENT_MUTATION_PATTERN)?.[1];
    const isShellBatch = command !== null && (
      SHELL_BATCH_PATTERN.test(command) || POWERSHELL_ARGUMENT_BATCH_PATTERN.test(command)
    );
    const signature = isTypedBatch
      ? `batch:${key}:${Array.isArray(input.operations) ? input.operations.length : -1}`
      : isQa
        ? `qa:${key}:${input.mode === 'strict' ? 'strict' : 'balanced'}`
        : `bash:${key}:${directVerb?.toLowerCase() ?? (isShellBatch ? 'batch' : 'other')}`;
    if (toolCallId) {
      const existing = this.decisionsByToolCallId.get(toolCallId);
      if (existing) {
        if (existing.signature === signature) return existing.decision;
        this.blockedCalls += 1;
        return {
          allowed: false,
          kind: 'protocol_conflict',
          reason: 'Conflicting duplicate OfficeCLI pre-tool request detected for the same tool call ID; execution was blocked to preserve call-budget integrity.',
        };
      }
    }

    const remember = (decision: OfficecliExecutionDecision): OfficecliExecutionDecision => {
      if (toolCallId) this.decisionsByToolCallId.set(toolCallId, { signature, decision });
      return decision;
    };

    this.attemptedToolCalls += 1;

    const isDirectMutation = isOfficeBash
      && command !== null
      && !isShellBatch
      && directVerb !== undefined;

    if (this.attemptedToolCalls >= REPLAN_CALL_THRESHOLD && !this.replanTriggered) {
      this.replanTriggered = true;
      this.blockedCalls += 1;
      return remember({
        allowed: false,
        kind: 'replan_required',
        reason: [
          'OfficeCLI has reached 20 tool calls in the current user task.',
          'Pause execution and replan once: consolidate independent mutations into officecli_batch, keep only dependency-sensitive structure operations separate, and finish with one balanced officecli_qa call.',
          'Advanced operations that cannot be batched remain available after this replan.',
        ].join(' '),
      });
    }

    if (isQa && this.qaCalls >= 2) {
      this.blockedCalls += 1;
      return remember({
        allowed: false,
        kind: 'qa_limit',
        reason: 'OfficeCLI QA has already run twice for this user task. Do not start another repair loop; report the remaining structural or visual limitation clearly.',
      });
    }

    if (isDirectMutation && (this.directMutationsByFile.get(key) ?? 0) >= DIRECT_MUTATION_LIMIT) {
      this.blockedCalls += 1;
      return remember({
        allowed: false,
        kind: 'direct_mutation_limit',
        reason: [
          'OfficeCLI direct-mutation budget reached for this user task.',
          'Replan the remaining independent add/set/remove/move/swap operations and submit them with officecli_batch (20–50 operations per batch).',
          'If the typed tool is unavailable, use one Bash heredoc invocation of `officecli batch`; do not continue one command per paragraph.',
        ].join(' '),
      });
    }

    this.toolCalls += 1;
    this.touchedFiles.add(key);
    if (isTypedBatch || (isOfficeBash && isShellBatch)) {
      this.batchCalls += 1;
      if (isTypedBatch && Array.isArray(input.operations)) {
        this.batchOperations += input.operations.length;
        this.batchSizes.push(input.operations.length);
      }
    }
    if (isQa) this.qaCalls += 1;
    if (isDirectMutation) {
      this.directMutations += 1;
      this.directMutationsByFile.set(key, (this.directMutationsByFile.get(key) ?? 0) + 1);
    }

    return remember({ allowed: true });
  }

  snapshot(): OfficecliExecutionSnapshot {
    return {
      attemptedToolCalls: this.attemptedToolCalls,
      toolCalls: this.toolCalls,
      batchCalls: this.batchCalls,
      batchOperations: this.batchOperations,
      batchSizes: [...this.batchSizes],
      directMutations: this.directMutations,
      qaCalls: this.qaCalls,
      qaModes: Object.fromEntries(this.qaModes),
      visualStatuses: Object.fromEntries(this.visualStatuses),
      blockedCalls: this.blockedCalls,
      replanTriggered: this.replanTriggered,
      fileCount: this.touchedFiles.size,
      executionMs: this.executionMs,
      errorTypes: Object.fromEntries(this.errorTypes),
      failedOperationIndexes: [...this.failedOperationIndexes].sort((a, b) => a - b),
    };
  }

  /** In-memory checkpoint for backend recreation. Do not emit it as telemetry. */
  checkpoint(): OfficecliExecutionCheckpoint {
    return {
      ...this.snapshot(),
      internalDirectMutationsByFile: [...this.directMutationsByFile.entries()],
    };
  }
}
