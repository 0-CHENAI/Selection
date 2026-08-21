import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import {
  executeOfficeCommand,
  officeToolResult,
  type OfficeBatchInput,
} from '../runtime/office-coordinator.ts';

export interface OfficeDocumentInspectArgs {
  argv: string[];
  timeoutMs?: number;
}

export interface OfficeDocumentEditArgs {
  argv: string[];
  batch?: OfficeBatchInput;
  timeoutMs?: number;
}

export async function handleOfficeDocumentInspect(
  ctx: SessionToolContext,
  args: OfficeDocumentInspectArgs,
): Promise<ToolResult> {
  const result = await executeOfficeCommand(ctx, {
    argv: args.argv,
    timeoutMs: args.timeoutMs,
    mode: 'inspect',
    cacheable: true,
    mutation: false,
  });
  return officeToolResult(result.envelope);
}

export async function handleOfficeDocumentEdit(
  ctx: SessionToolContext,
  args: OfficeDocumentEditArgs,
): Promise<ToolResult> {
  const result = await executeOfficeCommand(ctx, {
    argv: args.argv,
    batch: args.batch,
    timeoutMs: args.timeoutMs,
    mode: 'edit',
    cacheable: false,
    mutation: true,
  });
  return officeToolResult(result.envelope);
}
