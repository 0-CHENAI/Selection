import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { chmodSync, copyFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import { resolveOfficecliDocumentPath } from './officecli-path.ts';
import { parseOfficecliJson, runOfficecli, withOfficecliFileLock } from '../runtime/officecli-runtime.ts';
import { OfficecliBatchSchema } from './officecli-schemas.ts';
import { sanitizeOfficecliAttribution } from './officecli-metadata.ts';

export type OfficecliOperation = {
  command: 'add' | 'set' | 'remove' | 'move' | 'swap' | 'get' | 'query';
  parent?: string;
  path?: string;
  selector?: string;
  type?: string;
  props?: Record<string, string | number | boolean>;
  to?: string;
  before?: string;
  after?: string;
  path2?: string;
};

export interface OfficecliBatchArgs {
  file: string;
  operations: OfficecliOperation[];
}

export interface OfficecliBatchResult {
  success: boolean;
  operationCount: number;
  appliedCount: number;
  rolledBack: boolean;
  failedIndex?: number;
  results: unknown[];
  error?: string;
  durationMs: number;
  commitStatus?: 'committed' | 'rolled_back' | 'not_started' | 'unknown';
  /** True when the client could not determine whether the resident process committed the batch. */
  commitUnknown?: boolean;
  metadataSanitized?: boolean;
  visibleBadgesRemoved?: number;
  errorType?: 'preflight' | 'commit_unknown' | 'metadata' | 'officecli' | 'process';
}

const MAX_BATCH_BYTES = 256 * 1024;

function needsDocxStylePreflight(operations: OfficecliOperation[]): boolean {
  return operations.some(operation => {
    if (operation.type?.toLowerCase() === 'toc') return true;
    const style = operation.props?.style;
    const id = operation.props?.id;
    return [style, id].some(value =>
      typeof value === 'string' && /^(Heading[1-9]|Title|TOCHeading)$/i.test(value)
    );
  });
}

function structuredResponse(result: OfficecliBatchResult, isError: boolean): ToolResult {
  const prefix = isError ? '[ERROR] ' : '';
  return {
    content: [{ type: 'text', text: `${prefix}${JSON.stringify(result, null, 2)}` }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError,
  };
}

export async function handleOfficecliBatch(
  ctx: SessionToolContext,
  args: OfficecliBatchArgs,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const validated = OfficecliBatchSchema.safeParse(args);
  if (!validated.success) {
    return errorResponse(`Invalid officecli_batch input: ${validated.error.issues.map(issue => issue.message).join('; ')}`);
  }
  args = validated.data;
  if (ctx.permissionMode === 'safe') {
    return errorResponse('officecli_batch is blocked in Safe mode because it mutates Office files.');
  }
  if (!ctx.officecli?.binaryPath) {
    return errorResponse('officecli_batch is unavailable because this Selection build has no app-managed OfficeCLI runtime.');
  }

  // Resolve and guard the requested location even when the model forgot the
  // required create step, so we can return a structured, actionable preflight
  // result without weakening path containment.
  const resolved = resolveOfficecliDocumentPath(ctx, args.file, { allowMissing: true });
  if (!resolved.file) return errorResponse(resolved.error ?? 'Invalid Office file path.');
  const file = resolved.file;
  if (!existsSync(file)) {
    return structuredResponse({
      success: false,
      operationCount: args.operations.length,
      appliedCount: 0,
      rolledBack: false,
      results: [],
      error: 'The target Office document does not exist. Create it once with the app-managed `officecli create` command before calling officecli_batch.',
      durationMs: Date.now() - startedAt,
      commitStatus: 'not_started',
      errorType: 'preflight',
    }, true);
  }
  const officecli = ctx.officecli;

  const input = JSON.stringify(args.operations);
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > MAX_BATCH_BYTES) {
    return errorResponse('officecli_batch input exceeds the 256KB limit. Split it into smaller batches.');
  }

  return withOfficecliFileLock(file, async () => {
    let batchStarted = false;
    let preflightBackup: string | undefined;
    const snapshotBeforePreflight = () => {
      preflightBackup = join(dirname(file), `.${randomUUID()}.officecli-preflight-backup`);
      copyFileSync(file, preflightBackup);
    };
    const restorePreflightSnapshot = () => {
      if (!preflightBackup) return;
      const replacement = join(dirname(file), `.${randomUUID()}.officecli-preflight-restore`);
      try {
        copyFileSync(preflightBackup, replacement);
        chmodSync(replacement, statSync(preflightBackup).mode & 0o7777);
        renameSync(replacement, file);
      } finally {
        rmSync(replacement, { force: true });
      }
    };
    const closeResidentBeforePackageRewrite = async () => {
      const closed = await runOfficecli(
        officecli.binaryPath,
        ['close', file, '--json'],
        { cwd: ctx.workingDirectory ?? ctx.workspacePath },
      );
      const json = parseOfficecliJson(closed.stdout);
      if (
        closed.timedOut || closed.outputTruncated || closed.stdinDeliveryFailed ||
        closed.exitCode !== 0 || json?.success !== true
      ) {
        throw new Error(closed.stderr.trim() || 'OfficeCLI resident close could not be confirmed.');
      }
    };
    try {
      const extension = extname(file).toLowerCase();
      if (
        (extension === '.docx' || extension === '.docm') &&
        needsDocxStylePreflight(args.operations) &&
        officecli.ensureDocxOutlineStyles
      ) {
        // The style helper predates typed batches and can mutate the document.
        // Snapshot first so a rejected/rolled-back batch is atomic from the
        // caller's perspective, including this prerequisite repair.
        snapshotBeforePreflight();
        const ready = await officecli.ensureDocxOutlineStyles(file);
        if (!ready) {
          await closeResidentBeforePackageRewrite();
          restorePreflightSnapshot();
          return structuredResponse({
            success: false,
            operationCount: args.operations.length,
            appliedCount: 0,
            rolledBack: false,
            results: [],
            error: 'Word heading style preflight failed; the atomic batch was not started.',
            durationMs: Date.now() - startedAt,
            commitStatus: 'not_started',
            errorType: 'preflight',
          }, true);
        }
      }

    batchStarted = true;
    const processResult = await runOfficecli(
      officecli.binaryPath,
      ['batch', file, '--stop-on-error', '--json'],
      { cwd: ctx.workingDirectory ?? ctx.workspacePath, stdin: input },
    );
    const parsed = parseOfficecliJson(processResult.stdout);
    const data = parsed?.data as Record<string, unknown> | undefined;
    // OfficeCLI echoes the failed input item, which may contain document text.
    // The model already has its request, so drop that echo from results and
    // keep telemetry/result envelopes content-free by default.
    const results = Array.isArray(data?.results)
      ? data.results.map(result => {
          if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
          const { item: _inputEcho, ...safeResult } = result as Record<string, unknown>;
          return safeResult;
        })
      : [];
    const summary = data?.summary as Record<string, unknown> | undefined;
    const failed = results.find(result =>
      !!result && typeof result === 'object' && (result as Record<string, unknown>).success === false
    ) as Record<string, unknown> | undefined;
    const rolledBack = parsed?.success === false && summary?.atomicRolledBack === true && !!failed;
    const successfulResults = results.length === args.operations.length && results.every((result, index) =>
      !!result && typeof result === 'object' &&
      (result as Record<string, unknown>).success === true &&
      (result as Record<string, unknown>).index === index
    );
    const summaryMatches = summary?.total === args.operations.length &&
      summary?.succeeded === args.operations.length &&
      summary?.failed === 0;
    const successEnvelopeValid = parsed?.success === true && successfulResults && summaryMatches;
    const transportUncertain = processResult.timedOut ||
      processResult.outputTruncated ||
      processResult.stdinDeliveryFailed;
    const success = !transportUncertain && processResult.exitCode === 0 && successEnvelopeValid;
    // Once execution starts, only a valid success envelope or explicit atomic
    // rollback proves the document state. Every other outcome is unknown.
    const commitUnknown = transportUncertain || (!success && !rolledBack);
    const appliedCount = success
      ? typeof summary?.succeeded === 'number' ? summary.succeeded : results.length
      : rolledBack ? 0 : typeof summary?.succeeded === 'number' ? summary.succeeded : 0;
    const error = success
      ? undefined
      : commitUnknown
        ? `OfficeCLI batch completion could not be confirmed${processResult.stdinDeliveryFailed
            ? ' because the complete request was not delivered to stdin'
            : processResult.timedOut
              ? ' because the process timed out'
              : processResult.outputTruncated
                ? ' because process output was truncated'
                : successEnvelopeValid
                  ? ''
                  : ' because the success/rollback envelope was incomplete or inconsistent'}. Do not retry automatically; inspect the document state first.`
        : typeof failed?.error === 'string'
          ? failed.error
          : processResult.stderr.trim() || 'OfficeCLI rejected the batch.';

    if (!success && rolledBack && !transportUncertain && preflightBackup) {
      try {
        await closeResidentBeforePackageRewrite();
        restorePreflightSnapshot();
      } catch (restoreError) {
        return structuredResponse({
          success: false,
          operationCount: args.operations.length,
          appliedCount: 0,
          rolledBack: false,
          results,
          ...(typeof failed?.index === 'number' ? { failedIndex: failed.index } : {}),
          error: `OfficeCLI rolled back the batch, but Selection could not restore the preflight snapshot: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}. Do not retry automatically; inspect the document state first.`,
          durationMs: Date.now() - startedAt,
          commitStatus: 'unknown',
          commitUnknown: true,
          errorType: 'commit_unknown',
        }, true);
      }
    }

    let metadataSanitized = false;
    let visibleBadgesRemoved = 0;
    if (success) {
      // A resident batch can report success while its mutations still live only
      // in memory. Sanitization atomically replaces the ZIP package; close the
      // resident first so it cannot reload/overwrite that replacement later.
      try {
        await closeResidentBeforePackageRewrite();
      } catch {
        return structuredResponse({
          success: false,
          operationCount: args.operations.length,
          appliedCount,
          rolledBack: false,
          results,
          error: 'The batch succeeded in the OfficeCLI resident, but its flush/close could not be confirmed before package sanitization. Do not retry automatically; inspect the document state first.',
          durationMs: Date.now() - startedAt,
          commitStatus: 'unknown',
          commitUnknown: true,
          errorType: 'commit_unknown',
        }, true);
      }
      try {
        const sanitization = sanitizeOfficecliAttribution(file, {
          allowVisibleAttribution:
            ctx.officecliAttributionPolicy === 'allow-visible' ||
            ctx.officecliAttributionPolicy === 'allow-all',
          allowMetadataAttribution:
            ctx.officecliAttributionPolicy === 'allow-metadata' ||
            ctx.officecliAttributionPolicy === 'allow-all',
        });
        metadataSanitized = sanitization.metadataChanged;
        visibleBadgesRemoved = sanitization.removedVisibleBadges;
      } catch (metadataError) {
        return structuredResponse({
          success: false,
          operationCount: args.operations.length,
          appliedCount,
          rolledBack: false,
          results,
          error: `The atomic batch committed, but unrequested OfficeCLI attribution could not be removed: ${metadataError instanceof Error ? metadataError.message : String(metadataError)}`,
          durationMs: Date.now() - startedAt,
          commitStatus: 'committed',
          errorType: 'metadata',
        }, true);
      }
    }

    return structuredResponse({
      success,
      operationCount: args.operations.length,
      appliedCount,
      rolledBack,
      ...(typeof failed?.index === 'number' ? { failedIndex: failed.index } : {}),
      results,
      ...(error ? { error } : {}),
      durationMs: Date.now() - startedAt,
      commitStatus: success ? 'committed' : commitUnknown ? 'unknown' : rolledBack ? 'rolled_back' : 'unknown',
      ...(commitUnknown ? { commitUnknown: true } : {}),
      ...(success ? { metadataSanitized, visibleBadgesRemoved } : {}),
      ...(!success ? { errorType: commitUnknown ? 'commit_unknown' as const : 'officecli' as const } : {}),
    }, !success);
    } catch (error) {
      if (!batchStarted && preflightBackup) {
        try {
          await closeResidentBeforePackageRewrite();
          restorePreflightSnapshot();
        } catch (restoreError) {
          return structuredResponse({
            success: false,
            operationCount: args.operations.length,
            appliedCount: 0,
            rolledBack: false,
            results: [],
            error: `The batch did not start, but Selection could not restore the style-preflight snapshot: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}. Do not retry automatically; inspect the document state first.`,
            durationMs: Date.now() - startedAt,
            commitStatus: 'unknown',
            commitUnknown: true,
            errorType: 'commit_unknown',
          }, true);
        }
      }
      return structuredResponse({
        success: false,
        operationCount: args.operations.length,
        appliedCount: 0,
        rolledBack: false,
        results: [],
        error: batchStarted
          ? `officecli_batch failed after execution started, so its commit status could not be confirmed: ${error instanceof Error ? error.message : String(error)}`
          : `officecli_batch failed before the atomic batch started: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startedAt,
        commitStatus: batchStarted ? 'unknown' : 'not_started',
        ...(batchStarted ? { commitUnknown: true } : {}),
        errorType: batchStarted ? 'commit_unknown' : 'preflight',
      }, true);
    } finally {
      if (preflightBackup) rmSync(preflightBackup, { force: true });
    }
  });
}
