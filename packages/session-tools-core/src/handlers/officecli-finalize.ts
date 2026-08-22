import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import { resolveOfficecliDocumentPath } from './officecli-path.ts';
import { OfficecliFinalizeSchema } from './officecli-schemas.ts';
import { parseOfficecliJson, runOfficecli, withOfficecliFileLock } from '../runtime/officecli-runtime.ts';
import {
  inspectOfficecliAttribution,
  sanitizeOfficecliAttribution,
  type OfficecliAttributionOptions,
} from './officecli-metadata.ts';

export interface OfficecliFinalizeArgs {
  file: string;
}

export interface OfficecliFinalizeResult {
  success: boolean;
  saved: boolean;
  closed: boolean;
  attributionClean: boolean;
  metadataSanitized: boolean;
  visibleBadgesRemoved: number;
  durationMs: number;
  error?: string;
  errorType?: 'save' | 'close' | 'attribution' | 'process';
}

function response(result: OfficecliFinalizeResult, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: `${isError ? '[ERROR] ' : ''}${JSON.stringify(result, null, 2)}` }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError,
  };
}

function attributionOptions(ctx: SessionToolContext): OfficecliAttributionOptions {
  return {
    allowVisibleAttribution:
      ctx.officecliAttributionPolicy === 'allow-visible' ||
      ctx.officecliAttributionPolicy === 'allow-all',
    allowMetadataAttribution:
      ctx.officecliAttributionPolicy === 'allow-metadata' ||
      ctx.officecliAttributionPolicy === 'allow-all',
  };
}

/**
 * Trusted finalization path for OfficeCLI documents.
 *
 * The attribution policy comes only from the host session context. It is never
 * accepted in model-controlled tool input. The resident is closed before the
 * package is rewritten so it cannot overwrite the sanitized ZIP afterward.
 */
export async function handleOfficecliFinalize(
  ctx: SessionToolContext,
  args: OfficecliFinalizeArgs,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const validated = OfficecliFinalizeSchema.safeParse(args);
  if (!validated.success) {
    return errorResponse(`Invalid officecli_finalize input: ${validated.error.issues.map(issue => issue.message).join('; ')}`);
  }
  args = validated.data;
  if (ctx.permissionMode === 'safe') {
    return errorResponse('officecli_finalize is blocked in Safe mode because save/close can mutate Office files.');
  }
  if (!ctx.officecli?.binaryPath) {
    return errorResponse('officecli_finalize is unavailable because this Selection build has no app-managed OfficeCLI runtime.');
  }
  const resolved = resolveOfficecliDocumentPath(ctx, args.file);
  if (!resolved.file) return errorResponse(resolved.error ?? 'Invalid Office file path.');
  const file = resolved.file;
  const cwd = ctx.workingDirectory ?? ctx.workspacePath;
  const options = attributionOptions(ctx);

  return withOfficecliFileLock(file, async () => {
    let metadataSanitized = false;
    let visibleBadgesRemoved = 0;
    let savedConfirmed = false;
    let closedConfirmed = false;
    const commandConfirmed = (result: Awaited<ReturnType<typeof runOfficecli>>) =>
      result.exitCode === 0 && !result.timedOut && !result.outputTruncated &&
      !result.stdinDeliveryFailed && parseOfficecliJson(result.stdout)?.success === true;
    try {
      const saved = await runOfficecli(ctx.officecli!.binaryPath, ['save', file, '--json'], { cwd });
      if (!commandConfirmed(saved)) {
        return response({
          success: false,
          saved: false,
          closed: false,
          attributionClean: false,
          metadataSanitized,
          visibleBadgesRemoved,
          durationMs: Date.now() - startedAt,
          error: saved.stderr.trim() || 'OfficeCLI save success could not be confirmed.',
          errorType: 'save',
        }, true);
      }
      savedConfirmed = true;

      const closed = await runOfficecli(ctx.officecli!.binaryPath, ['close', file, '--json'], { cwd });
      if (!commandConfirmed(closed)) {
        return response({
          success: false,
          saved: true,
          closed: false,
          attributionClean: false,
          metadataSanitized,
          visibleBadgesRemoved,
          durationMs: Date.now() - startedAt,
          error: closed.stderr.trim() || 'OfficeCLI close success could not be confirmed.',
          errorType: 'close',
        }, true);
      }
      closedConfirmed = true;

      const afterClose = sanitizeOfficecliAttribution(file, options);
      metadataSanitized = afterClose.metadataChanged;
      visibleBadgesRemoved = afterClose.removedVisibleBadges;
      const finalInspection = inspectOfficecliAttribution(file, options);
      if (!finalInspection.clean) {
        return response({
          success: false,
          saved: true,
          closed: true,
          attributionClean: false,
          metadataSanitized,
          visibleBadgesRemoved,
          durationMs: Date.now() - startedAt,
          error: `OfficeCLI attribution remains in ${finalInspection.entries.join(', ')}.`,
          errorType: 'attribution',
        }, true);
      }

      return response({
        success: true,
        saved: true,
        closed: true,
        attributionClean: true,
        metadataSanitized,
        visibleBadgesRemoved,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      return response({
        success: false,
        saved: savedConfirmed,
        closed: closedConfirmed,
        attributionClean: false,
        metadataSanitized,
        visibleBadgesRemoved,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        errorType: 'process',
      }, true);
    }
  });
}
