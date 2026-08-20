import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { extname, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { createSanitizedEnv } from '../runtime/sandbox-env.ts';
import { isPathWithinDirectory } from '../runtime/path-security.ts';
import { resolveOfficecliRuntime } from '../runtime/officecli.ts';
import {
  OFFICE_ALREADY_CHECKED_MESSAGE,
  OFFICE_ALREADY_CHECKED_SUGGESTION,
  OFFICE_BUDGET_EXHAUSTED_MESSAGE,
  OFFICE_BUDGET_EXHAUSTED_SUGGESTION,
  OFFICE_INSPECT_BUDGET_LIMIT,
  OFFICE_MAX_BATCH_FILE_BYTES,
  OFFICE_MAX_INLINE_ARGUMENTS_CHARS,
  OFFICE_MAX_INLINE_BATCH_CHARS,
  OFFICE_MAX_INLINE_BATCH_COMMANDS,
  OFFICE_PAYLOAD_TOO_LARGE_SUGGESTION,
  OFFICE_REFRESH_NON_WINDOWS_NOTE,
  OFFICE_TRUNCATED_PREVIEW_CHARS,
  OFFICE_TRUNCATION_SUGGESTION,
  isOfficeBudgetResettingEdit,
  isOfficeDocxPath,
  isOfficeInspectCountedCommand,
  officeInspectBudgetKey,
  officeInspectFingerprint,
  resolveOfficeDocumentPath,
} from '../office-workflow.ts';

export type OfficeDocumentInspectCommand =
  | 'status'
  | 'help'
  | 'view'
  | 'get'
  | 'query'
  | 'validate'
  | 'dump'
  | 'raw';

export type OfficeDocumentEditCommand =
  | 'create'
  | 'set'
  | 'add'
  | 'remove'
  | 'move'
  | 'swap'
  | 'refresh'
  | 'raw-set'
  | 'add-part'
  | 'batch'
  | 'import'
  | 'merge';

export interface OfficeDocumentInspectArgs {
  command: OfficeDocumentInspectCommand;
  arguments?: string[];
  timeoutMs?: number;
}

export interface OfficeDocumentEditArgs {
  command: OfficeDocumentEditCommand;
  arguments?: string[];
  batchCommands?: Array<Record<string, unknown>>;
  batchCommandsFile?: string;
  timeoutMs?: number;
}

interface OfficecliProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

type OfficecliProcessRunner = (
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { timeoutMs: number },
) => Promise<OfficecliProcessResult>;

export interface OfficecliExecutionDependencies {
  resolveRuntime?: typeof resolveOfficecliRuntime;
  runProcess?: OfficecliProcessRunner;
  now?: () => number;
  platform?: NodeJS.Platform;
}

interface OfficeDocumentError {
  code: string;
  message: string;
  suggestion?: string;
  help?: string;
}

export interface OfficeDocumentResultPayload extends Record<string, unknown> {
  ok: boolean;
  availability: 'available' | 'unavailable';
  version?: string;
  command: string;
  exitCode?: number | null;
  durationMs: number;
  data?: unknown;
  truncated?: boolean;
  preview?: string;
  suggestion?: string;
  platformNote?: string;
  code?: string;
  message?: string;
  error?: OfficeDocumentError;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const VERSION_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_CHARS = 100_000;
const INSPECT_COMMANDS: ReadonlySet<string> = new Set([
  'status', 'help', 'view', 'get', 'query', 'validate', 'dump', 'raw',
]);
const EDIT_COMMANDS: ReadonlySet<string> = new Set([
  'create', 'set', 'add', 'remove', 'move', 'swap', 'refresh',
  'raw-set', 'add-part', 'batch', 'import', 'merge',
]);
const INSPECT_FORBIDDEN_FLAGS = new Set(['--out', '-o', '--save', '--browser', '--jsonl']);
const BATCH_INPUT_FLAGS = new Set(['--commands', '--input']);
const BATCH_FORBIDDEN_COMMANDS = new Set([
  'install', 'skills', 'load_skill', 'mcp', 'plugins',
  'watch', 'unwatch', 'open', 'close', 'save',
]);
const versionCache = new Map<string, string>();

interface InspectBudgetState {
  count: number;
  fingerprints: Set<string>;
}

const inspectBudget = new Map<string, InspectBudgetState>();

export function clearOfficeInspectBudget(): void {
  inspectBudget.clear();
}

function inspectBudgetState(key: string): InspectBudgetState {
  const existing = inspectBudget.get(key);
  if (existing) return existing;
  const created: InspectBudgetState = { count: 0, fingerprints: new Set() };
  inspectBudget.set(key, created);
  return created;
}

function inspectPolicyResult(
  command: string,
  code: 'already_checked' | 'verification_budget_exhausted',
  message: string,
  suggestion: string,
): ToolResult {
  return toolResult({
    ok: true,
    availability: 'available',
    command,
    durationMs: 0,
    code,
    message,
    suggestion,
  });
}

function inspectBudgetShortCircuit(
  sessionId: string,
  command: string,
  argumentList: string[] | undefined,
  cwd: string,
): ToolResult | undefined {
  if (!isOfficeInspectCountedCommand(command)) return undefined;
  const filePath = resolveOfficeDocumentPath(argumentList, cwd);
  if (!filePath) return undefined;
  const key = officeInspectBudgetKey(sessionId, filePath);
  const fingerprint = officeInspectFingerprint(command, argumentList, cwd);
  const state = inspectBudgetState(key);
  if (state.fingerprints.has(fingerprint)) {
    return inspectPolicyResult(
      command,
      'already_checked',
      OFFICE_ALREADY_CHECKED_MESSAGE,
      OFFICE_ALREADY_CHECKED_SUGGESTION,
    );
  }
  if (state.count >= OFFICE_INSPECT_BUDGET_LIMIT) {
    return inspectPolicyResult(
      command,
      'verification_budget_exhausted',
      OFFICE_BUDGET_EXHAUSTED_MESSAGE,
      OFFICE_BUDGET_EXHAUSTED_SUGGESTION,
    );
  }
  return undefined;
}

function recordInspectUse(
  sessionId: string,
  command: string,
  argumentList: string[] | undefined,
  cwd: string,
): void {
  if (!isOfficeInspectCountedCommand(command)) return;
  const filePath = resolveOfficeDocumentPath(argumentList, cwd);
  if (!filePath) return;
  const state = inspectBudgetState(officeInspectBudgetKey(sessionId, filePath));
  state.fingerprints.add(officeInspectFingerprint(command, argumentList, cwd));
  state.count += 1;
}

function resetInspectBudgetForFile(
  sessionId: string,
  argumentList: string[] | undefined,
  cwd: string,
): void {
  const filePath = resolveOfficeDocumentPath(argumentList, cwd);
  if (!filePath) return;
  inspectBudget.delete(officeInspectBudgetKey(sessionId, filePath));
}

function truncatedPreview(data: unknown, rawStdout?: string): string {
  if (typeof data === 'string' && data.length > 0) return data;
  if (data !== undefined) {
    try {
      const serialized = JSON.stringify(data);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to raw stdout.
    }
  }
  return rawStdout ?? '';
}

function applyResultEnvelope(
  payload: OfficeDocumentResultPayload,
  platform: NodeJS.Platform,
  rawStdout?: string,
  filePath?: string,
): OfficeDocumentResultPayload {
  const next: OfficeDocumentResultPayload = { ...payload };
  if (next.truncated) {
    const source = truncatedPreview(next.data, rawStdout);
    delete next.data;
    next.preview = source.slice(0, OFFICE_TRUNCATED_PREVIEW_CHARS);
    next.suggestion = OFFICE_TRUNCATION_SUGGESTION;
  }
  if (next.command === 'refresh' && platform !== 'win32' && isOfficeDocxPath(filePath)) {
    next.platformNote = OFFICE_REFRESH_NON_WINDOWS_NOTE;
  }
  return next;
}

function appendBounded(current: string, chunk: string): { text: string; truncated: boolean } {
  if (current.length >= MAX_OUTPUT_CHARS) {
    return { text: current, truncated: true };
  }
  const remaining = MAX_OUTPUT_CHARS - current.length;
  return {
    text: current + chunk.slice(0, remaining),
    truncated: chunk.length > remaining,
  };
}

export async function runOfficecliProcess(
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { timeoutMs: number },
): Promise<OfficecliProcessResult> {
  return new Promise((resolve, reject) => {
    const { timeoutMs, ...spawnOptions } = options;
    const child: ChildProcessWithoutNullStreams = spawn(binary, args, {
      ...spawnOptions,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const appended = appendBounded(stdout, chunk.toString());
      stdout = appended.text;
      truncated ||= appended.truncated;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const appended = appendBounded(stderr, chunk.toString());
      stderr = appended.text;
      truncated ||= appended.truncated;
    });
    child.stdin.end();

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', exitCode => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut, truncated });
    });
  });
}

function toolResult(payload: OfficeDocumentResultPayload): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: !payload.ok,
  };
}

function invalidArguments(command: string, message: string): ToolResult {
  return toolResult({
    ok: false,
    availability: 'available',
    command,
    durationMs: 0,
    error: { code: 'invalid_arguments', message },
  });
}

function payloadTooLarge(command: string, message: string): ToolResult {
  return toolResult({
    ok: false,
    availability: 'available',
    command,
    durationMs: 0,
    error: {
      code: 'payload_too_large',
      message,
      suggestion: OFFICE_PAYLOAD_TOO_LARGE_SUGGESTION,
    },
  });
}

function forbiddenBatchItem(
  items: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return items.find(item => {
    return [item.command, item.op].some(nestedCommand => (
      typeof nestedCommand === 'string'
      && BATCH_FORBIDDEN_COMMANDS.has(nestedCommand.trim().toLowerCase())
    ));
  });
}

function parseBatchCommandList(text: string): Array<Record<string, unknown>> | string {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      return 'batchCommandsFile must contain a JSON array of command objects.';
    }
    return parsed as Array<Record<string, unknown>>;
  } catch (error) {
    return `batchCommandsFile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function resolveBatchCommandsFilePath(
  ctx: SessionToolContext,
  rawPath: string,
  cwd: string,
): { path: string } | ToolResult {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return invalidArguments('batch', 'batchCommandsFile must be a non-empty path.');
  }
  const resolved = resolve(cwd, trimmed);
  if (extname(resolved).toLowerCase() !== '.json') {
    return invalidArguments('batch', 'batchCommandsFile must be a .json file.');
  }
  const allowedRoots = [cwd, ctx.workspacePath].filter(Boolean);
  if (!allowedRoots.some(root => isPathWithinDirectory(resolved, root))) {
    return invalidArguments(
      'batch',
      'batchCommandsFile must be inside the working directory or workspace.',
    );
  }
  if (!ctx.fs.exists(resolved)) {
    return invalidArguments('batch', `batchCommandsFile not found: ${trimmed}`);
  }
  const stats = ctx.fs.stat(resolved);
  if (stats.isDirectory()) {
    return invalidArguments('batch', 'batchCommandsFile must be a .json file, not a directory.');
  }
  if (stats.size > OFFICE_MAX_BATCH_FILE_BYTES) {
    return payloadTooLarge(
      'batch',
      `batchCommandsFile exceeds the ${OFFICE_MAX_BATCH_FILE_BYTES} byte limit.`,
    );
  }
  return { path: resolved };
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  return Math.min(Math.max(timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
}

function flagName(argument: string): string {
  return argument.split('=', 1)[0] ?? argument;
}

function matchesFlag(argument: string, flags: ReadonlySet<string>): boolean {
  if (flags.has(flagName(argument))) return true;
  for (const flag of flags) {
    if (argument.startsWith(`${flag}:`)) return true;
    if (flag.length === 2 && flag.startsWith('-') && argument.startsWith(flag)) return true;
  }
  return false;
}

function validateInvocation(
  args: OfficeDocumentInspectArgs | OfficeDocumentEditArgs,
  mode: 'inspect' | 'edit',
): ToolResult | undefined {
  const value = args as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidArguments('unknown', 'Office document tool input must be an object.');
  }

  const record = value as Record<string, unknown>;
  const command = typeof record.command === 'string' ? record.command : 'unknown';
  const allowedCommands = mode === 'inspect' ? INSPECT_COMMANDS : EDIT_COMMANDS;
  if (!allowedCommands.has(command)) {
    return invalidArguments(command, `Command '${command}' is not allowed in the ${mode} Office document tool.`);
  }

  if (record.arguments !== undefined && (
    !Array.isArray(record.arguments)
    || record.arguments.some(argument => typeof argument !== 'string')
  )) {
    return invalidArguments(command, 'arguments must be an array of strings.');
  }

  if (record.timeoutMs !== undefined && (
    typeof record.timeoutMs !== 'number'
    || !Number.isInteger(record.timeoutMs)
    || record.timeoutMs < 1
    || record.timeoutMs > MAX_TIMEOUT_MS
  )) {
    return invalidArguments(command, `timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
  }

  if (record.batchCommands !== undefined && (
    !Array.isArray(record.batchCommands)
    || record.batchCommands.some(item => !item || typeof item !== 'object' || Array.isArray(item))
  )) {
    return invalidArguments(command, 'batchCommands must be an array of command objects.');
  }

  if (record.batchCommandsFile !== undefined && (
    typeof record.batchCommandsFile !== 'string'
    || record.batchCommandsFile.trim().length === 0
  )) {
    return invalidArguments(command, 'batchCommandsFile must be a non-empty path.');
  }

  return undefined;
}

function chooseWorkingDirectory(ctx: SessionToolContext): string {
  if (ctx.workingDirectory && ctx.fs.isDirectory(ctx.workingDirectory)) {
    return ctx.workingDirectory;
  }
  const cwd = process.cwd();
  if (ctx.fs.isDirectory(cwd)) return cwd;
  return ctx.workspacePath;
}

function buildEnvironment(): NodeJS.ProcessEnv {
  return {
    ...createSanitizedEnv(),
    OFFICECLI_NO_AUTO_RESIDENT: '1',
    OFFICECLI_RESIDENT_FLUSH: 'each',
    NO_COLOR: '1',
  };
}

function parseJson(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizedUpstreamError(parsed: Record<string, unknown> | undefined, fallback: string): OfficeDocumentError {
  const rawError = parsed?.error;
  if (rawError && typeof rawError === 'object' && !Array.isArray(rawError)) {
    const value = rawError as Record<string, unknown>;
    return {
      code: typeof value.code === 'string' ? value.code : 'execution_failed',
      message: typeof value.error === 'string'
        ? value.error
        : typeof value.message === 'string'
          ? value.message
          : fallback,
      ...(typeof value.suggestion === 'string' ? { suggestion: value.suggestion } : {}),
      ...(typeof value.help === 'string' ? { help: value.help } : {}),
    };
  }

  const invalid = /required|unrecognized|unknown command|argument/i.test(fallback);
  return {
    code: invalid ? 'invalid_arguments' : 'execution_failed',
    message: fallback || 'OfficeCLI execution failed.',
  };
}

async function getVersion(
  binary: string,
  runner: OfficecliProcessRunner,
  cwd: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const cached = versionCache.get(binary);
  if (cached) return cached;
  try {
    const result = await runner(binary, ['--version'], {
      cwd,
      env: buildEnvironment(),
      timeoutMs,
    });
    if (result.exitCode === 0 && !result.timedOut) {
      const version = result.stdout.trim();
      if (version) {
        versionCache.set(binary, version);
        return version;
      }
    }
  } catch {
    // The main command returns the actionable execution error.
  }
  return undefined;
}

export function clearOfficecliVersionCache(): void {
  versionCache.clear();
}

async function executeOfficecli(
  ctx: SessionToolContext,
  args: OfficeDocumentInspectArgs | OfficeDocumentEditArgs,
  mode: 'inspect' | 'edit',
  dependencies: OfficecliExecutionDependencies = {},
): Promise<ToolResult> {
  const platform = dependencies.platform ?? process.platform;
  const cwd = chooseWorkingDirectory(ctx);
  const filePath = resolveOfficeDocumentPath(args.arguments, cwd);
  const emit = (payload: OfficeDocumentResultPayload, rawStdout?: string) => (
    toolResult(applyResultEnvelope(payload, platform, rawStdout, filePath))
  );

  const validationError = validateInvocation(args, mode);
  if (validationError) return validationError;

  const commandArgs = [...(args.arguments ?? [])];
  if (args.command === 'status' && commandArgs.length > 0) {
    return invalidArguments(args.command, 'status does not accept arguments.');
  }
  if (mode === 'inspect') {
    const forbidden = commandArgs.find(arg => matchesFlag(arg, INSPECT_FORBIDDEN_FLAGS));
    if (forbidden) {
      return invalidArguments(args.command, `Argument '${forbidden}' is not allowed in the read-only Office document tool.`);
    }
  }

  const batchCommands = 'batchCommands' in args ? args.batchCommands : undefined;
  const batchCommandsFile = 'batchCommandsFile' in args ? args.batchCommandsFile : undefined;
  if (batchCommands && args.command !== 'batch') {
    return invalidArguments(args.command, 'batchCommands is only valid when command is batch.');
  }
  if (batchCommandsFile && args.command !== 'batch') {
    return invalidArguments(args.command, 'batchCommandsFile is only valid when command is batch.');
  }
  const joinedArguments = commandArgs.join(' ');
  if (joinedArguments.length > OFFICE_MAX_INLINE_ARGUMENTS_CHARS) {
    return payloadTooLarge(
      args.command,
      `arguments exceed the ${OFFICE_MAX_INLINE_ARGUMENTS_CHARS} character inline limit.`,
    );
  }
  if (args.command === 'batch') {
    if (commandArgs.some(arg => matchesFlag(arg, BATCH_INPUT_FLAGS))) {
      return invalidArguments(
        args.command,
        'Use batchCommands or batchCommandsFile instead of --commands or --input.',
      );
    }
    const hasInline = Array.isArray(batchCommands) && batchCommands.length > 0;
    const hasFile = typeof batchCommandsFile === 'string' && batchCommandsFile.trim().length > 0;
    if (hasInline === hasFile) {
      return invalidArguments(
        args.command,
        'batch requires exactly one of batchCommands or batchCommandsFile.',
      );
    }
    if (hasFile) {
      const resolved = resolveBatchCommandsFilePath(ctx, batchCommandsFile!, cwd);
      if (!('path' in resolved)) return resolved;
      let fileText: string;
      try {
        fileText = ctx.fs.readFile(resolved.path);
      } catch (error) {
        return invalidArguments(
          args.command,
          `batchCommandsFile could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (Buffer.byteLength(fileText, 'utf8') > OFFICE_MAX_BATCH_FILE_BYTES) {
        return payloadTooLarge(
          args.command,
          `batchCommandsFile exceeds the ${OFFICE_MAX_BATCH_FILE_BYTES} byte limit.`,
        );
      }
      const parsed = parseBatchCommandList(fileText);
      if (typeof parsed === 'string') {
        return invalidArguments(args.command, parsed);
      }
      if (parsed.length === 0) {
        return invalidArguments(args.command, 'batchCommandsFile must contain at least one command.');
      }
      const forbiddenItem = forbiddenBatchItem(parsed);
      if (forbiddenItem) {
        const nestedCommand = typeof forbiddenItem.command === 'string'
          ? forbiddenItem.command
          : forbiddenItem.op;
        return invalidArguments(
          args.command,
          `Batch command '${String(nestedCommand)}' is not allowed.`,
        );
      }
      commandArgs.push('--input', resolved.path);
    } else {
      const forbiddenItem = forbiddenBatchItem(batchCommands!);
      if (forbiddenItem) {
        const nestedCommand = typeof forbiddenItem.command === 'string'
          ? forbiddenItem.command
          : forbiddenItem.op;
        return invalidArguments(
          args.command,
          `Batch command '${String(nestedCommand)}' is not allowed.`,
        );
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(batchCommands);
      } catch (error) {
        return invalidArguments(
          args.command,
          `batchCommands could not be serialized: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (
        batchCommands!.length > OFFICE_MAX_INLINE_BATCH_COMMANDS
        || serialized.length > OFFICE_MAX_INLINE_BATCH_CHARS
      ) {
        return payloadTooLarge(
          args.command,
          `batchCommands exceed the inline limit of ${OFFICE_MAX_INLINE_BATCH_COMMANDS} commands or ${OFFICE_MAX_INLINE_BATCH_CHARS} characters.`,
        );
      }
      commandArgs.push('--commands', serialized);
    }
  }

  if (mode === 'inspect') {
    const blocked = inspectBudgetShortCircuit(ctx.sessionId, args.command, args.arguments, cwd);
    if (blocked) return blocked;
  }

  const resolveRuntime = dependencies.resolveRuntime ?? resolveOfficecliRuntime;
  const runtime = resolveRuntime();
  if (!runtime) {
    return emit({
      ok: false,
      availability: 'unavailable',
      command: args.command,
      durationMs: 0,
      error: {
        code: 'officecli_unavailable',
        message: `OfficeCLI is not bundled for ${process.platform}-${process.arch}.`,
        suggestion: 'Reinstall or rebuild Selection with the OfficeCLI asset for this platform.',
      },
    });
  }

  const runner = dependencies.runProcess ?? runOfficecliProcess;
  const now = dependencies.now ?? Date.now;
  const timeoutMs = normalizeTimeout(args.timeoutMs);
  const startedAt = now();
  const version = await getVersion(
    runtime.path,
    runner,
    cwd,
    Math.min(timeoutMs, VERSION_TIMEOUT_MS),
  );

  if (args.command === 'status') {
    const durationMs = Math.max(0, now() - startedAt);
    if (!version) {
      return emit({
        ok: false,
        availability: 'unavailable',
        command: 'status',
        durationMs,
        error: {
          code: 'execution_failed',
          message: 'The bundled OfficeCLI binary was found but its version could not be read.',
          suggestion: 'Reinstall or rebuild Selection and verify the OfficeCLI executable permissions.',
        },
      });
    }
    return emit({
      ok: true,
      availability: 'available',
      version,
      command: 'status',
      durationMs,
      data: {
        source: runtime.source,
        path: runtime.path,
        platform: `${process.platform}-${process.arch}`,
      },
    });
  }

  const cliArgs = [
    args.command,
    ...commandArgs.filter(arg => arg !== '--json' && !arg.startsWith('--json=')),
    '--json',
  ];
  const elapsedBeforeCommand = Math.max(0, now() - startedAt);
  const commandTimeoutMs = timeoutMs - elapsedBeforeCommand;
  if (commandTimeoutMs <= 0) {
    return emit({
      ok: false,
      availability: 'available',
      version,
      command: args.command,
      durationMs: elapsedBeforeCommand,
      error: {
        code: 'timeout',
        message: `OfficeCLI exceeded the ${timeoutMs}ms timeout during version detection.`,
        suggestion: 'Retry with a larger timeoutMs value.',
      },
    });
  }

  const finishInspect = (result: ToolResult, ok: boolean): ToolResult => {
    if (mode === 'inspect') {
      if (ok) recordInspectUse(ctx.sessionId, args.command, args.arguments, cwd);
    } else if (ok && isOfficeBudgetResettingEdit(args.command)) {
      resetInspectBudgetForFile(ctx.sessionId, args.arguments, cwd);
    }
    return result;
  };

  try {
    const result = await runner(runtime.path, cliArgs, {
      cwd,
      env: buildEnvironment(),
      timeoutMs: commandTimeoutMs,
    });
    const durationMs = Math.max(0, now() - startedAt);
    if (result.timedOut) {
      return finishInspect(emit({
        ok: false,
        availability: 'available',
        version,
        command: args.command,
        exitCode: result.exitCode,
        durationMs,
        truncated: result.truncated || undefined,
        error: {
          code: 'timeout',
          message: `OfficeCLI exceeded the ${timeoutMs}ms timeout.`,
          suggestion: 'Retry with a narrower operation or a larger timeoutMs value.',
        },
      }, result.stdout), false);
    }

    const parsed = parseJson(result.stdout);
    const upstreamSuccess = parsed?.success;
    const ok = result.exitCode === 0 && upstreamSuccess !== false;
    if (!ok) {
      const fallback = result.stderr.trim() || result.stdout.trim();
      return finishInspect(emit({
        ok: false,
        availability: 'available',
        version,
        command: args.command,
        exitCode: result.exitCode,
        durationMs,
        truncated: result.truncated || undefined,
        error: normalizedUpstreamError(parsed, fallback),
      }, result.stdout), false);
    }

    return finishInspect(emit({
      ok: true,
      availability: 'available',
      version,
      command: args.command,
      exitCode: result.exitCode,
      durationMs,
      data: parsed && 'data' in parsed ? parsed.data : parsed ?? result.stdout.trim(),
      truncated: result.truncated || undefined,
    }, result.stdout), true);
  } catch (error) {
    return finishInspect(emit({
      ok: false,
      availability: 'available',
      version,
      command: args.command,
      durationMs: Math.max(0, now() - startedAt),
      error: {
        code: 'execution_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }), false);
  }
}

export function handleOfficeDocumentInspect(
  ctx: SessionToolContext,
  args: OfficeDocumentInspectArgs,
): Promise<ToolResult> {
  return executeOfficecli(ctx, args, 'inspect');
}

export function handleOfficeDocumentEdit(
  ctx: SessionToolContext,
  args: OfficeDocumentEditArgs,
): Promise<ToolResult> {
  return executeOfficecli(ctx, args, 'edit');
}

export function executeOfficecliForTest(
  ctx: SessionToolContext,
  args: OfficeDocumentInspectArgs | OfficeDocumentEditArgs,
  mode: 'inspect' | 'edit',
  dependencies: OfficecliExecutionDependencies,
): Promise<ToolResult> {
  return executeOfficecli(ctx, args, mode, dependencies);
}
