import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import {
  accessSync,
  constants,
  createReadStream,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type {
  ArtifactRef,
  OfficeErrorCategory,
  OfficeResultEnvelope,
  OfficeStructuredError,
  StructuredWarning,
} from '../office-types.ts';
import type { ToolContent, ToolResult } from '../types.ts';
import { createSanitizedEnv } from './sandbox-env.ts';
import {
  isPathWithinDirectory,
  isPathWithinDirectoryForCreation,
} from './path-security.ts';
import { resolveOfficecliRuntime } from './officecli.ts';
import { resolveOfficecliResources } from './office-manifest.ts';
import { validateMorphGlb } from './office-recipes.ts';

export const OFFICE_DEFAULT_TIMEOUT_MS = 120_000;
export const OFFICE_MAX_TIMEOUT_MS = 300_000;
export const OFFICE_MAX_INLINE_BATCH_COMMANDS = 200;
export const OFFICE_MAX_INLINE_BATCH_CHARS = 500_000;
export const OFFICE_MAX_BATCH_FILE_BYTES = 5_000_000;

const METADATA_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_CHARS = 500_000;
const MAX_PATH_LENGTH = 4096;
const OFFICE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx']);
const JSON_FLAGS = new Set(['--json']);
const READ_FORBIDDEN_FLAGS = new Set([
  '--browser', '--jsonl', '--out', '-o', '--output', '--save', '--force',
]);
const BATCH_SOURCE_FLAGS = new Set(['--commands', '--input']);
const RENDERING_VIEW_MODES = new Set(['html', 'h', 'svg', 'g', 'screenshot', 'pdf', 'forms']);
const LOCAL_ASSET_PROPS = new Set(['src', 'file', 'image', 'poster', 'audio', 'video', 'model']);
const IMMUTABLE_FORBIDDEN_COMMANDS = new Set([
  'install', 'update', 'skills', 'load_skill', 'mcp', 'plugins', 'config',
  'open', 'save', 'close',
]);
// Kept in lockstep with OfficeCLI 1.0.144 CommandBuilder.ExecuteBatchItem.
// A root command being reviewed as read/edit does not imply it is valid inside
// a batch document lease.
const BATCH_ALLOWED_COMMANDS = new Set([
  'meta', 'get', 'query', 'set', 'add', 'import', 'remove', 'move', 'swap',
  'view', 'raw', 'raw-set', 'add-part', 'validate',
]);
const BATCH_ALLOWED_FIELDS = new Set([
  'command', 'op', 'path', 'parent', 'type', 'from', 'index', 'after', 'before',
  'to', 'path2', 'props', 'selector', 'text', 'mode', 'depth', 'part', 'xpath',
  'action', 'xml', 'dumpversion',
]);

export interface OfficecliProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export type OfficecliProcessRunner = (
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { timeoutMs: number },
) => Promise<OfficecliProcessResult>;

export interface OfficeBatchInput {
  commands?: string[];
  file?: string;
}

export type OfficeExecutionMode = 'inspect' | 'edit' | 'preview' | 'internal';

export interface OfficeExecutionRequest {
  argv: string[];
  mode: OfficeExecutionMode;
  batch?: OfficeBatchInput;
  timeoutMs?: number;
  /** Internal calls may opt out when a command writes only a preview artifact. */
  mutation?: boolean;
  cacheable?: boolean;
}

export interface OfficeExecutionOutcome {
  envelope: OfficeResultEnvelope;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cwd: string;
  binary?: string;
}

export interface OfficeCoordinatorDependencies {
  resolveRuntime?: typeof resolveOfficecliRuntime;
  resolveResources?: typeof resolveOfficecliResources;
  runProcess?: OfficecliProcessRunner;
  hashRuntime?: (path: string) => Promise<string>;
  now?: () => number;
}

interface RuntimeMetadata {
  version: string;
  schemaCrc: string;
}

interface ArtifactState {
  revision: number;
  statKey: string;
}

interface FailureState {
  fingerprint: string;
  count: number;
}

const metadataCache = new Map<string, RuntimeMetadata>();
const runtimeIntegrityCache = new Map<string, { statKey: string; sha256: string }>();
const artifactStates = new Map<string, ArtifactState>();
const inspectCache = new Map<string, OfficeResultEnvelope>();
const failureStates = new Map<string, FailureState>();
const mutatedBySession = new Set<string>();

function boundedAppend(current: string, chunk: string): { text: string; truncated: boolean } {
  if (current.length >= MAX_OUTPUT_CHARS) return { text: current, truncated: true };
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
  return new Promise((resolvePromise, reject) => {
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
      const appended = boundedAppend(stdout, chunk.toString());
      stdout = appended.text;
      truncated ||= appended.truncated;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const appended = boundedAppend(stderr, chunk.toString());
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
      resolvePromise({ stdout, stderr, exitCode, timedOut, truncated });
    });
  });
}

export function buildOfficeEnvironment(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...createSanitizedEnv(baseEnv),
    OFFICECLI_SKIP_UPDATE: '1',
    OFFICECLI_NO_AUTO_INSTALL: '1',
    OFFICECLI_NO_AUTO_RESIDENT: '1',
    OFFICECLI_RESIDENT_FLUSH: 'each',
    NO_COLOR: '1',
  };
}

function structuredError(
  code: string,
  category: OfficeErrorCategory,
  message: string,
  options: Partial<Pick<OfficeStructuredError, 'upstreamCode' | 'retriable' | 'recovery'>> = {},
): OfficeStructuredError {
  return {
    code,
    category,
    message,
    retriable: options.retriable ?? false,
    ...(options.upstreamCode ? { upstreamCode: options.upstreamCode } : {}),
    ...(options.recovery ? { recovery: options.recovery } : {}),
  };
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  return Math.min(Math.max(timeoutMs ?? OFFICE_DEFAULT_TIMEOUT_MS, 1), OFFICE_MAX_TIMEOUT_MS);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function chooseOfficeWorkingDirectory(ctx: SessionToolContext): string {
  if (ctx.workingDirectory) {
    const explicit = resolve(ctx.workingDirectory);
    if (!isDirectory(explicit)) {
      throw structuredError(
        'working_directory_not_found',
        'path',
        `Session working directory does not exist or is not a directory: ${explicit}`,
        { recovery: 'Choose an existing session working directory before retrying.' },
      );
    }
    return realpathSync.native(explicit);
  }
  for (const candidate of [ctx.sessionPath, ctx.workspacePath]) {
    if (candidate && isDirectory(candidate)) return realpathSync.native(resolve(candidate));
  }
  throw structuredError(
    'working_directory_unavailable',
    'path',
    'No valid session working directory, session directory, or workspace directory is available.',
    { recovery: 'Set an existing working directory for this session.' },
  );
}

function allowedRoots(ctx: SessionToolContext, cwd: string): string[] {
  return [...new Set([cwd, ctx.sessionPath, ctx.workspacePath]
    .filter((value): value is string => Boolean(value && isDirectory(value)))
    .map(value => realpathSync.native(resolve(value))))];
}

function pathInsideAnyRoot(path: string, roots: string[], forCreation: boolean): boolean {
  return roots.some(root => forCreation
    ? isPathWithinDirectoryForCreation(path, root)
    : isPathWithinDirectory(path, root));
}

function resolveArgumentPath(raw: string, cwd: string): string {
  const lexical = normalize(isAbsolute(raw) ? raw : join(cwd, raw));
  if (existsSync(lexical)) return realpathSync.native(lexical);

  // Canonicalize through the nearest existing ancestor. This handles both
  // symlink escapes and platform aliases such as macOS /var -> /private/var
  // before the lexical containment check runs.
  const ancestor = nearestExistingAncestor(lexical);
  try {
    return resolve(realpathSync.native(ancestor), relative(ancestor, lexical));
  } catch {
    return resolve(lexical);
  }
}

function ensurePathLength(path: string): void {
  if (path.length <= MAX_PATH_LENGTH) return;
  throw structuredError(
    'path_too_long',
    'path',
    `Path exceeds Selection's ${MAX_PATH_LENGTH}-character safety limit: ${path}`,
  );
}

function ensureExistingFile(path: string, roots: string[]): void {
  ensurePathLength(path);
  if (!existsSync(path)) {
    throw structuredError('file_not_found', 'path', `Input file does not exist: ${path}`);
  }
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    throw structuredError(
      'path_unreadable',
      'permission',
      `Cannot inspect input path ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!stats.isFile()) {
    throw structuredError('expected_file', 'path', `Expected a file but found a directory: ${path}`);
  }
  if (!pathInsideAnyRoot(path, roots, false)) {
    throw structuredError(
      'path_outside_allowed_roots',
      'permission',
      `Path is outside the session working directory, session data, and workspace: ${path}`,
      { recovery: 'Move the file into an authorized folder or change the session working directory.' },
    );
  }
  try {
    accessSync(path, constants.R_OK);
  } catch {
    throw structuredError('file_not_readable', 'permission', `Input file is not readable: ${path}`);
  }
}

function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function ensureOutputParent(path: string, roots: string[]): void {
  ensurePathLength(path);
  if (!pathInsideAnyRoot(path, roots, true)) {
    throw structuredError(
      'path_outside_allowed_roots',
      'permission',
      `Output path is outside the session working directory, session data, and workspace: ${path}`,
      { recovery: 'Choose an output path inside an authorized folder.' },
    );
  }
  const parent = dirname(path);
  const ancestor = nearestExistingAncestor(parent);
  let ancestorStats;
  try {
    ancestorStats = statSync(ancestor);
  } catch (error) {
    throw structuredError(
      'output_parent_unavailable',
      'path',
      `Cannot inspect output parent ${ancestor}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!ancestorStats.isDirectory()) {
    throw structuredError(
      'output_parent_is_file',
      'path',
      `An output parent component is a file, not a directory: ${ancestor}`,
    );
  }
  try {
    accessSync(ancestor, constants.W_OK | constants.X_OK);
  } catch {
    throw structuredError(
      'output_parent_not_writable',
      'permission',
      `Output parent is not writable: ${ancestor}`,
    );
  }
  try {
    mkdirSync(parent, { recursive: true });
  } catch (error) {
    throw structuredError(
      'output_directory_create_failed',
      'permission',
      `Could not create output directory ${parent}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function flagName(token: string): string {
  return token.split('=', 1)[0] ?? token;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.some(token => flagName(token) === flag);
}

function optionValues(argv: string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === option) {
      const value = argv[index + 1];
      if (value !== undefined) values.push(value);
      index += 1;
    } else if (token.startsWith(`${option}=`)) {
      values.push(token.slice(option.length + 1));
    }
  }
  return values;
}

function isRemoteOrEmbeddedResource(value: string): boolean {
  return /^(?:https?:|data:)/i.test(value);
}

function ensureLocalInput(raw: string, cwd: string, roots: string[]): string {
  const path = resolveArgumentPath(raw, cwd);
  ensureExistingFile(path, roots);
  return path;
}

function ensureMorphGlbInput(raw: string, cwd: string, roots: string[]): string {
  const path = ensureLocalInput(raw, cwd, roots);
  const error = validateMorphGlb(path);
  if (error) {
    throw structuredError('invalid_morph_glb', 'input', error, {
      recovery: 'Use a valid .glb file inside the authorized workspace or session path.',
    });
  }
  return path;
}

function validateCommandInputResources(
  argv: string[],
  command: string,
  cwd: string,
  roots: string[],
): void {
  if (command === 'import') {
    if (hasFlag(argv, '--stdin')) {
      throw structuredError(
        'stdin_not_supported',
        'unsupported',
        'office_document_edit does not accept raw stdin. Use an authorized CSV/TSV source file.',
      );
    }
    const optionFile = optionValues(argv, '--file')[0];
    const positionalFile = argv[3] && !argv[3].startsWith('-') ? argv[3] : undefined;
    const source = optionFile ?? positionalFile;
    if (source) ensureLocalInput(source, cwd, roots);
  }

  if (command === 'merge') {
    const data = optionValues(argv, '--data')[0];
    if (data && !data.trim().startsWith('{') && !data.trim().startsWith('[')) {
      ensureLocalInput(data, cwd, roots);
    }
  }

  if (command === 'add' || command === 'set') {
    const elementType = optionValues(argv, '--type')[0]?.toLowerCase();
    for (const prop of optionValues(argv, '--prop')) {
      const separator = prop.indexOf('=');
      if (separator <= 0) continue;
      const name = prop.slice(0, separator).trim().toLowerCase();
      const value = prop.slice(separator + 1).trim();
      if (elementType === '3dmodel' && name === 'path' && value) {
        ensureMorphGlbInput(value, cwd, roots);
        continue;
      }
      if (!LOCAL_ASSET_PROPS.has(name) || !value || isRemoteOrEmbeddedResource(value)) continue;
      ensureLocalInput(value, cwd, roots);
    }
  }
}

function officePathTokens(argv: string[]): Array<{ index: number; value: string; path: string }> {
  const result: Array<{ index: number; value: string; path: string }> = [];
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index] ?? '';
    if (!value || value.startsWith('-') || !OFFICE_EXTENSIONS.has(extname(value).toLowerCase())) continue;
    result.push({ index, value, path: value });
  }
  return result;
}

export function resolveOfficeDocumentPath(argv: string[], cwd: string): string | undefined {
  const tokens = officePathTokens(argv);
  if (tokens.length === 0) return undefined;
  const selected = argv[0] === 'merge' && tokens.length > 1 ? tokens[1] : tokens[0];
  return selected ? resolveArgumentPath(selected.value, cwd) : undefined;
}

function validateDocumentPaths(
  ctx: SessionToolContext,
  argv: string[],
  mode: OfficeExecutionMode,
  cwd: string,
): string | undefined {
  const roots = allowedRoots(ctx, cwd);
  const tokens = officePathTokens(argv).map(token => ({
    ...token,
    path: resolveArgumentPath(token.value, cwd),
  }));
  const command = argv[0] ?? '';
  if (command === 'create') {
    const output = tokens[0]?.path;
    if (!output) return undefined;
    ensureOutputParent(output, roots);
    if (existsSync(output) && !hasFlag(argv, '--force')) {
      throw structuredError(
        'output_exists',
        'conflict',
        `Output file already exists: ${output}`,
        { recovery: 'Choose a new output path or explicitly add --force.' },
      );
    }
    return output;
  }
  if (command === 'merge') {
    const template = tokens[0]?.path;
    const output = tokens[1]?.path;
    if (template) ensureExistingFile(template, roots);
    if (output) {
      ensureOutputParent(output, roots);
      if (existsSync(output) && !hasFlag(argv, '--force')) {
        throw structuredError(
          'output_exists',
          'conflict',
          `Output file already exists: ${output}`,
          { recovery: 'Choose a new output path or explicitly add --force.' },
        );
      }
    }
    validateCommandInputResources(argv, command, cwd, roots);
    return output ?? template;
  }
  const document = tokens[0]?.path;
  if (document) ensureExistingFile(document, roots);
  validateCommandInputResources(argv, command, cwd, roots);
  if (command === 'view') {
    const output = optionValues(argv, '--out')[0] ?? optionValues(argv, '-o')[0];
    if (output) ensureOutputParent(resolveArgumentPath(output, cwd), roots);
  }
  if (mode === 'edit' && document) {
    try {
      accessSync(document, constants.W_OK);
    } catch {
      throw structuredError('file_not_writable', 'permission', `Document is not writable: ${document}`);
    }
  }
  return document;
}

function parseBatchCommands(commands: string[]): Array<Record<string, unknown>> {
  if (commands.length === 0) {
    throw structuredError('empty_batch', 'input', 'batch.commands must contain at least one JSON command object.');
  }
  if (commands.length > OFFICE_MAX_INLINE_BATCH_COMMANDS) {
    throw structuredError(
      'batch_too_large',
      'input',
      `batch.commands exceeds the ${OFFICE_MAX_INLINE_BATCH_COMMANDS}-command inline limit.`,
      { recovery: 'Write the JSON array to a file and use batch.file.' },
    );
  }
  return commands.map((command, index) => {
    try {
      const parsed = JSON.parse(command);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, unknown>;
    } catch (error) {
      throw structuredError(
        'invalid_batch_command',
        'input',
        `batch.commands[${index}] must be one JSON object string: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

function validateNestedBatchCommands(
  items: Array<Record<string, unknown>>,
  cwd: string,
  roots: string[],
): void {
  for (const [index, item] of items.entries()) {
    const unknownField = Object.keys(item).find(field => !BATCH_ALLOWED_FIELDS.has(field.toLowerCase()));
    if (unknownField) {
      throw structuredError(
        'unknown_batch_field',
        'input',
        `Batch item ${index} contains an unsupported field: ${unknownField}.`,
        { recovery: 'Use only fields declared by the pinned OfficeCLI batch schema.' },
      );
    }
    const rawCommand = typeof item.command === 'string'
      ? item.command
      : typeof item.op === 'string'
        ? item.op
        : '';
    const command = rawCommand.trim().toLowerCase();
    if (!command || !BATCH_ALLOWED_COMMANDS.has(command) || IMMUTABLE_FORBIDDEN_COMMANDS.has(command)) {
      throw structuredError(
        'forbidden_batch_command',
        'unsupported',
        `Batch item ${index} uses a command that is not supported by the pinned batch executor: ${command || '(missing)'}.`,
      );
    }
    if (command === 'view') {
      const mode = typeof item.mode === 'string' ? item.mode.trim().toLowerCase() : 'text';
      if (RENDERING_VIEW_MODES.has(mode)) {
        throw structuredError(
          'batch_render_requires_preview',
          'unsupported',
          `Batch item ${index} requests view mode '${mode}', which belongs to office_document_preview.render.`,
        );
      }
    }
    if (command === 'add' || command === 'set') {
      const props = item.props;
      const entries: Array<[string, unknown]> = Array.isArray(props)
        ? props.flatMap(value => {
            if (typeof value !== 'string') return [];
            const separator = value.indexOf('=');
            return separator > 0 ? [[value.slice(0, separator), value.slice(separator + 1)]] : [];
          })
        : props && typeof props === 'object'
          ? Object.entries(props)
          : [];
      for (const [name, rawValue] of entries) {
        if (String(item.type ?? '').toLowerCase() === '3dmodel' && name.toLowerCase() === 'path' && typeof rawValue === 'string') {
          ensureMorphGlbInput(rawValue.trim(), cwd, roots);
          continue;
        }
        if (!LOCAL_ASSET_PROPS.has(name.toLowerCase()) || typeof rawValue !== 'string') continue;
        const value = rawValue.trim();
        if (!value || isRemoteOrEmbeddedResource(value)) continue;
        ensureLocalInput(value, cwd, roots);
      }
    }
  }
}

function prepareBatch(
  ctx: SessionToolContext,
  argv: string[],
  batch: OfficeBatchInput | undefined,
  cwd: string,
): string[] {
  const hasBatchSourceFlag = argv.some(token => BATCH_SOURCE_FLAGS.has(flagName(token)));
  if (argv[0] !== 'batch') {
    if (batch) throw structuredError('batch_not_allowed', 'input', 'batch is only valid when argv[0] is "batch".');
    return argv;
  }
  if (hasBatchSourceFlag) {
    throw structuredError(
      'batch_source_must_be_structured',
      'input',
      'Do not put --commands or --input in argv; use batch.commands or batch.file.',
    );
  }
  const hasCommands = Array.isArray(batch?.commands);
  const hasFile = typeof batch?.file === 'string' && batch.file.trim().length > 0;
  if (hasCommands === hasFile) {
    throw structuredError(
      'batch_source_required',
      'input',
      'batch requires exactly one of batch.commands or batch.file.',
    );
  }
  if (hasCommands) {
    const roots = allowedRoots(ctx, cwd);
    const items = parseBatchCommands(batch!.commands!);
    validateNestedBatchCommands(items, cwd, roots);
    const serialized = JSON.stringify(items);
    if (serialized.length > OFFICE_MAX_INLINE_BATCH_CHARS) {
      throw structuredError(
        'batch_too_large',
        'input',
        `batch.commands exceeds the ${OFFICE_MAX_INLINE_BATCH_CHARS}-character inline limit.`,
        { recovery: 'Write the JSON array to a file and use batch.file.' },
      );
    }
    return [...argv, '--commands', serialized];
  }
  const roots = allowedRoots(ctx, cwd);
  const file = resolveArgumentPath(batch!.file!.trim(), cwd);
  if (extname(file).toLowerCase() !== '.json') {
    throw structuredError('invalid_batch_file', 'input', 'batch.file must be a .json file.');
  }
  ensureExistingFile(file, roots);
  const stats = statSync(file);
  if (stats.size > OFFICE_MAX_BATCH_FILE_BYTES) {
    throw structuredError(
      'batch_file_too_large',
      'input',
      `batch.file exceeds the ${OFFICE_MAX_BATCH_FILE_BYTES}-byte limit.`,
    );
  }
  let items: unknown;
  try {
    // Context FS keeps this path testable and avoids an additional async dependency.
    items = JSON.parse(ctx.fs.readFile(file));
  } catch (error) {
    throw structuredError(
      'invalid_batch_file',
      'input',
      `batch.file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw structuredError('invalid_batch_file', 'input', 'batch.file must contain a JSON array of command objects.');
  }
  validateNestedBatchCommands(items as Array<Record<string, unknown>>, cwd, roots);
  return [...argv, '--input', file];
}

function validateArgv(argv: unknown, timeoutMs: unknown): asserts argv is string[] {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(token => typeof token !== 'string' || token.includes('\0'))) {
    throw structuredError('invalid_argv', 'input', 'argv must be a non-empty array of native OfficeCLI string tokens.');
  }
  if (argv[0] === 'officecli' || argv[0] === 'officecli.exe') {
    throw structuredError('binary_prefix_forbidden', 'input', 'Remove the officecli binary prefix; argv starts with the command verb.');
  }
  if (
    timeoutMs !== undefined
    && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > OFFICE_MAX_TIMEOUT_MS)
  ) {
    throw structuredError(
      'invalid_timeout',
      'input',
      `timeoutMs must be an integer between 1 and ${OFFICE_MAX_TIMEOUT_MS}.`,
    );
  }
}

function classifyAndValidateCommand(
  argv: string[],
  mode: OfficeExecutionMode,
  policy: { read: string[]; edit: string[]; preview: string[]; lifecycle: string[]; admin: string[] },
): void {
  const command = argv[0]!.trim().toLowerCase();
  if (IMMUTABLE_FORBIDDEN_COMMANDS.has(command)) {
    throw structuredError(
      'management_command_forbidden',
      'unsupported',
      `OfficeCLI command '${command}' is managed by Selection and is never exposed to agents.`,
    );
  }
  const read = new Set(policy.read);
  const edit = new Set(policy.edit);
  const preview = new Set(policy.preview);
  const lifecycle = new Set(policy.lifecycle);
  const admin = new Set(policy.admin);
  if (admin.has(command) || lifecycle.has(command)) {
    throw structuredError(
      'management_command_forbidden',
      'unsupported',
      `OfficeCLI command '${command}' is managed by Selection and is never exposed to agents.`,
    );
  }
  if (mode === 'inspect' && !read.has(command)) {
    throw structuredError('command_not_read_only', 'unsupported', `Command '${command}' is not classified as read-only.`);
  }
  if (mode === 'edit' && !edit.has(command)) {
    throw structuredError('command_not_editable', 'unsupported', `Command '${command}' is not classified as an edit command.`);
  }
  if (mode === 'preview' && !preview.has(command) && command !== 'get') {
    throw structuredError('command_not_preview', 'unsupported', `Command '${command}' is not classified as a preview command.`);
  }
  if (mode === 'internal' && !read.has(command) && !edit.has(command) && !preview.has(command)) {
    throw structuredError('unknown_command', 'unsupported', `Command '${command}' has not been reviewed in the OfficeCLI manifest.`);
  }
  if (!read.has(command) && !edit.has(command) && !preview.has(command) && mode !== 'internal') {
    throw structuredError('unknown_command', 'unsupported', `Command '${command}' has not been reviewed in the OfficeCLI manifest.`);
  }
  if (mode === 'inspect') {
    const forbidden = argv.find(token => READ_FORBIDDEN_FLAGS.has(flagName(token)));
    if (forbidden) {
      throw structuredError(
        'read_output_forbidden',
        'input',
        `Read-only inspection does not allow '${forbidden}'. Use office_document_preview for rendering.`,
      );
    }
    if (command === 'view' && argv[2] && RENDERING_VIEW_MODES.has(argv[2].toLowerCase())) {
      throw structuredError(
        'render_requires_preview',
        'unsupported',
        `view ${argv[2]} belongs to office_document_preview.render.`,
      );
    }
  }
}

/** Translate Selection's stable logical aliases to the pinned native grammar. */
function translateLogicalArgv(argv: string[]): string[] {
  if (argv[0]?.trim().toLowerCase() !== 'get-marks') return argv;
  const file = argv[1];
  if (!file || file.startsWith('-')) {
    throw structuredError('file_required', 'input', 'get-marks requires an Office document path.');
  }
  return ['watch', file, 'marks', file, ...argv.slice(2)];
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function extractSuccess(data: unknown): boolean | undefined {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>).success as boolean | undefined
    : undefined;
}

function extractData(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  return 'data' in record ? record.data : data;
}

function findStringKey(data: unknown, names: Set<string>, depth = 0): string | undefined {
  if (depth > 4 || !data || typeof data !== 'object') return undefined;
  if (Array.isArray(data)) {
    for (const item of data.slice(0, 20)) {
      const found = findStringKey(item, names, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (names.has(key.toLowerCase()) && typeof value === 'string') return value;
  }
  for (const value of Object.values(data as Record<string, unknown>)) {
    const found = findStringKey(value, names, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function extractBackend(data: unknown): string | undefined {
  return findStringKey(data, new Set(['backend', 'renderer', 'renderbackend', 'engine']));
}

function warningFromUnknown(value: unknown): StructuredWarning | undefined {
  if (typeof value === 'string' && value.trim()) {
    return { code: 'upstream_warning', message: value.trim(), severity: 'medium' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const message = typeof record.message === 'string'
    ? record.message
    : typeof record.warning === 'string'
      ? record.warning
      : undefined;
  if (!message) return undefined;
  return {
    code: typeof record.code === 'string' ? record.code : 'upstream_warning',
    message,
    severity: record.severity === 'high' || record.severity === 'low' ? record.severity : 'medium',
  };
}

function extractWarnings(parsed: unknown, stderr: string, truncated: boolean): StructuredWarning[] {
  const warnings: StructuredWarning[] = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const raw = (parsed as Record<string, unknown>).warnings;
    const items = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    for (const item of items) {
      const warning = warningFromUnknown(item);
      if (warning) warnings.push(warning);
    }
  }
  if (stderr.trim()) {
    warnings.push({ code: 'upstream_stderr', message: stderr.trim(), severity: 'medium' });
  }
  if (truncated) {
    warnings.push({
      code: 'output_truncated',
      message: `OfficeCLI output exceeded ${MAX_OUTPUT_CHARS} characters and was truncated.`,
      severity: 'medium',
      recovery: 'Use a narrower view, query, get, page, or range request.',
    });
  }
  return warnings;
}

function upstreamError(parsed: unknown, fallback: string): OfficeStructuredError {
  let upstreamCode: string | undefined;
  let message = fallback || 'OfficeCLI execution failed.';
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const raw = (parsed as Record<string, unknown>).error;
    if (typeof raw === 'string') message = raw;
    else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      upstreamCode = typeof record.code === 'string' ? record.code : undefined;
      message = typeof record.error === 'string'
        ? record.error
        : typeof record.message === 'string'
          ? record.message
          : message;
    }
  }
  const lower = `${upstreamCode ?? ''} ${message}`.toLowerCase();
  if (/locked|busy|resident/.test(lower)) {
    return structuredError('file_busy', 'conflict', message, {
      upstreamCode,
      retriable: true,
      recovery: 'Close the external editor or preview holding the file, then retry.',
    });
  }
  if (/not found|does not exist|missing file/.test(lower)) {
    return structuredError('file_not_found', 'path', message, { upstreamCode });
  }
  if (/permission|access denied|unauthorized/.test(lower)) {
    return structuredError('permission_denied', 'permission', message, { upstreamCode });
  }
  if (/unsupported|not available|requires/.test(lower)) {
    return structuredError('dependency_unavailable', 'dependency', message, {
      upstreamCode,
      recovery: 'Use the reported fallback backend or install the required external dependency outside Selection.',
    });
  }
  if (/required|unrecognized|unknown|argument|parse/.test(lower)) {
    return structuredError('invalid_arguments', 'input', message, { upstreamCode });
  }
  return structuredError('execution_failed', 'runtime', message, {
    upstreamCode,
    retriable: true,
  });
}

function statKey(path: string): string {
  try {
    const stats = statSync(path);
    return `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
  } catch {
    return 'missing';
  }
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(digest.digest('hex')));
  });
}

async function runtimeSha256(
  path: string,
  hashRuntime: (path: string) => Promise<string>,
): Promise<{ sha256: string; cacheHit: boolean; cacheKey: string }> {
  const currentStatKey = statKey(path);
  const cached = runtimeIntegrityCache.get(path);
  if (cached?.statKey === currentStatKey) {
    return {
      sha256: cached.sha256,
      cacheHit: true,
      cacheKey: `${path}\0${currentStatKey}\0${cached.sha256}`,
    };
  }
  const sha256 = (await hashRuntime(path)).trim().toLowerCase();
  runtimeIntegrityCache.set(path, { statKey: currentStatKey, sha256 });
  return { sha256, cacheHit: false, cacheKey: `${path}\0${currentStatKey}\0${sha256}` };
}

export function getOfficeArtifactRevision(path: string | undefined): number | undefined {
  if (!path) return undefined;
  const canonical = existsSync(path) ? realpathSync.native(path) : resolve(path);
  const currentKey = statKey(canonical);
  const existing = artifactStates.get(canonical);
  if (!existing) {
    artifactStates.set(canonical, { revision: 1, statKey: currentKey });
    return 1;
  }
  if (existing.statKey !== currentKey) {
    existing.revision += 1;
    existing.statKey = currentKey;
  }
  return existing.revision;
}

function markMutation(path: string, sessionId: string): number {
  const canonical = existsSync(path) ? realpathSync.native(path) : resolve(path);
  const existing = artifactStates.get(canonical);
  const revision = (existing?.revision ?? 0) + 1;
  artifactStates.set(canonical, { revision, statKey: statKey(canonical) });
  mutatedBySession.add(`${sessionId}\0${canonical}`);
  for (const key of inspectCache.keys()) {
    if (key.includes(`\0${canonical}\0`)) inspectCache.delete(key);
  }
  return revision;
}

export function wasOfficeArtifactMutatedBySession(sessionId: string, path: string): boolean {
  const canonical = existsSync(path) ? realpathSync.native(path) : resolve(path);
  return mutatedBySession.has(`${sessionId}\0${canonical}`);
}

function documentArtifact(path: string, revision: number | undefined): ArtifactRef | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return undefined;
    return {
      kind: 'document',
      path,
      mimeType: extname(path).toLowerCase() === '.docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : extname(path).toLowerCase() === '.xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: stats.size,
      artifactRevision: revision,
    };
  } catch {
    return undefined;
  }
}

function cacheFingerprint(argv: string[], cwd: string, revision: number | undefined): string {
  return `${cwd}\0${revision ?? 0}\0${JSON.stringify(argv)}`;
}

function cacheKey(sessionId: string, documentPath: string | undefined, fingerprint: string): string {
  return `${sessionId}\0${documentPath ?? '(none)'}\0${fingerprint}`;
}

function failureKey(sessionId: string, documentPath: string | undefined): string {
  return `${sessionId}\0${documentPath ?? '(none)'}`;
}

function errorEnvelope(
  version: string,
  schemaCrc: string,
  argv: string[],
  cwd: string,
  error: OfficeStructuredError,
  durationMs = 0,
  documentPath?: string,
): OfficeResultEnvelope {
  return {
    ok: false,
    version,
    schemaCrc,
    command: argv,
    cwd,
    ...(documentPath ? { documentPath } : {}),
    durationMs,
    warnings: [],
    cacheHit: false,
    artifacts: [],
    error,
  };
}

function thrownOfficeError(error: unknown): OfficeStructuredError {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && 'category' in error
    && 'message' in error
    && 'retriable' in error
  ) {
    return error as OfficeStructuredError;
  }
  return structuredError(
    'runtime_error',
    'runtime',
    error instanceof Error ? error.message : String(error),
    { retriable: true },
  );
}

async function runtimeMetadata(
  binary: string,
  cacheKey: string,
  runner: OfficecliProcessRunner,
  cwd: string,
): Promise<RuntimeMetadata | undefined> {
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;
  const env = buildOfficeEnvironment();
  const [versionResult, schemaResult] = await Promise.all([
    runner(binary, ['--version'], { cwd, env, timeoutMs: METADATA_TIMEOUT_MS }),
    runner(binary, ['--output-schema-crc'], { cwd, env, timeoutMs: METADATA_TIMEOUT_MS }),
  ]);
  if (
    versionResult.exitCode !== 0
    || schemaResult.exitCode !== 0
    || versionResult.timedOut
    || schemaResult.timedOut
  ) return undefined;
  const version = versionResult.stdout.trim();
  const schemaCrc = schemaResult.stdout.trim().toLowerCase();
  if (!version || !/^[0-9a-f]{8}$/i.test(schemaCrc)) return undefined;
  const metadata = { version, schemaCrc };
  metadataCache.set(cacheKey, metadata);
  return metadata;
}

export function officeToolResult(
  envelope: OfficeResultEnvelope,
  extraContent: ToolContent[] = [],
): ToolResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify(envelope, null, 2) },
      ...extraContent,
    ],
    structuredContent: envelope,
    isError: !envelope.ok,
  };
}

export async function executeOfficeCommand(
  ctx: SessionToolContext,
  request: OfficeExecutionRequest,
  dependencies: OfficeCoordinatorDependencies = {},
): Promise<OfficeExecutionOutcome> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let cwd = ctx.workspacePath || ctx.sessionPath || '';
  let argv = Array.isArray(request.argv) ? [...request.argv] : [];
  let documentPath: string | undefined;
  let expectedVersion = 'unknown';
  let expectedSchema = 'unknown';
  try {
    validateArgv(request.argv, request.timeoutMs);
    argv = request.argv.map(token => token);
    cwd = chooseOfficeWorkingDirectory(ctx);
    const resources = (dependencies.resolveResources ?? resolveOfficecliResources)();
    if (!resources) {
      return {
        envelope: errorEnvelope(
          expectedVersion,
          expectedSchema,
          argv,
          cwd,
          structuredError(
            'officecli_resources_unavailable',
            'dependency',
            'The bundled OfficeCLI manifest and internal guide resources could not be resolved.',
            { recovery: 'Reinstall or rebuild Selection with resources/officecli.' },
          ),
        ),
        stdout: '', stderr: '', exitCode: null, cwd,
      };
    }
    expectedVersion = resources.manifest.version;
    expectedSchema = resources.manifest.schemaCrc;
    classifyAndValidateCommand(argv, request.mode, resources.manifest.commandPolicy);
    argv = translateLogicalArgv(argv);
    argv = prepareBatch(ctx, argv, request.batch, cwd);
    documentPath = validateDocumentPaths(ctx, argv, request.mode, cwd);

    const runtime = (dependencies.resolveRuntime ?? resolveOfficecliRuntime)();
    if (!runtime) {
      return {
        envelope: errorEnvelope(
          expectedVersion,
          expectedSchema,
          argv,
          cwd,
          structuredError(
            'officecli_unavailable',
            'dependency',
            `OfficeCLI is not bundled for ${process.platform}-${process.arch}.`,
            { recovery: 'Reinstall or rebuild Selection with the matching platform asset.' },
          ),
          Math.max(0, now() - startedAt),
          documentPath,
        ),
        stdout: '', stderr: '', exitCode: null, cwd,
      };
    }
    const runner = dependencies.runProcess ?? runOfficecliProcess;
    const platformKey = `${process.platform}-${process.arch}`;
    const reviewedAsset = resources.manifest.assets[platformKey];
    if (!reviewedAsset) {
      return {
        envelope: errorEnvelope(
          expectedVersion,
          expectedSchema,
          argv,
          cwd,
          structuredError(
            'officecli_asset_unreviewed',
            'dependency',
            `The OfficeCLI manifest has no reviewed binary asset for ${platformKey}.`,
            { recovery: 'Use a Selection build that includes a reviewed asset for this platform.' },
          ),
          Math.max(0, now() - startedAt),
          documentPath,
        ),
        stdout: '', stderr: '', exitCode: null, cwd, binary: runtime.path,
      };
    }
    let integrity;
    try {
      integrity = await runtimeSha256(runtime.path, dependencies.hashRuntime ?? sha256File);
    } catch (error) {
      return {
        envelope: errorEnvelope(
          expectedVersion,
          expectedSchema,
          argv,
          cwd,
          structuredError(
            'runtime_checksum_unavailable',
            'dependency',
            `Selection could not hash the OfficeCLI runtime: ${error instanceof Error ? error.message : String(error)}`,
            { recovery: 'Reinstall or rebuild Selection with an intact OfficeCLI binary.' },
          ),
          Math.max(0, now() - startedAt),
          documentPath,
        ),
        stdout: '', stderr: '', exitCode: null, cwd, binary: runtime.path,
      };
    }
    if (integrity.sha256 !== reviewedAsset.sha256.toLowerCase()) {
      return {
        envelope: {
          ...errorEnvelope(
            expectedVersion,
            expectedSchema,
            argv,
            cwd,
            structuredError(
              'runtime_checksum_mismatch',
              'dependency',
              `OfficeCLI runtime SHA256 does not match the reviewed ${platformKey} asset.`,
              { recovery: 'Reinstall or rebuild Selection; do not run the unreviewed binary.' },
            ),
            Math.max(0, now() - startedAt),
            documentPath,
          ),
          data: { actualSha256: integrity.sha256, expectedSha256: reviewedAsset.sha256 },
        },
        stdout: '', stderr: '', exitCode: null, cwd, binary: runtime.path,
      };
    }
    const metadataWasCached = metadataCache.has(integrity.cacheKey);
    const metadata = await runtimeMetadata(runtime.path, integrity.cacheKey, runner, cwd);
    if (!metadata) {
      return {
        envelope: errorEnvelope(
          expectedVersion,
          expectedSchema,
          argv,
          cwd,
          structuredError(
            'runtime_metadata_unavailable',
            'runtime',
            'The OfficeCLI binary was found, but version or schema CRC could not be read.',
            { recovery: 'Verify the bundled binary exists and is executable.' },
          ),
          Math.max(0, now() - startedAt),
          documentPath,
        ),
        stdout: '', stderr: '', exitCode: null, cwd, binary: runtime.path,
      };
    }
    if (metadata.version !== expectedVersion || metadata.schemaCrc !== expectedSchema.toLowerCase()) {
      return {
        envelope: {
          ...errorEnvelope(
            expectedVersion,
            expectedSchema,
            argv,
            cwd,
            structuredError(
              'runtime_manifest_mismatch',
              'dependency',
              `Bundled OfficeCLI metadata does not match the reviewed manifest (binary ${metadata.version}/${metadata.schemaCrc}, manifest ${expectedVersion}/${expectedSchema}).`,
              { recovery: 'Reinstall Selection or rebuild all OfficeCLI assets from one manifest revision.' },
            ),
            Math.max(0, now() - startedAt),
            documentPath,
          ),
          data: { actualVersion: metadata.version, actualSchemaCrc: metadata.schemaCrc },
        },
        stdout: '', stderr: '', exitCode: null, cwd, binary: runtime.path,
      };
    }

    if (argv[0] === 'status') {
      return {
        envelope: {
          ok: true,
          version: metadata.version,
          schemaCrc: metadata.schemaCrc,
          command: ['status'],
          cwd,
          durationMs: Math.max(0, now() - startedAt),
          data: {
            source: runtime.source,
            path: runtime.path,
            platform: `${process.platform}-${process.arch}`,
            tagCommit: resources.manifest.tagCommit,
            sha256: integrity.sha256,
          },
          warnings: [],
          cacheHit: metadataWasCached,
          artifacts: [],
        },
        stdout: metadata.version,
        stderr: '',
        exitCode: 0,
        cwd,
        binary: runtime.path,
      };
    }

    const revisionBefore = getOfficeArtifactRevision(documentPath);
    const normalizedArgv = argv.filter(token => !JSON_FLAGS.has(flagName(token)));
    const cliArgv = [...normalizedArgv, '--json'];
    const fingerprint = cacheFingerprint(normalizedArgv, cwd, revisionBefore);
    const resultCacheKey = cacheKey(ctx.sessionId, documentPath, fingerprint);
    const shouldCache = request.cacheable ?? request.mode === 'inspect';
    const cached = shouldCache ? inspectCache.get(resultCacheKey) : undefined;
    if (cached) {
      return {
        envelope: { ...cached, cacheHit: true, durationMs: Math.max(0, now() - startedAt) },
        stdout: '', stderr: '', exitCode: 0, cwd, binary: runtime.path,
      };
    }
    const failures = failureStates.get(failureKey(ctx.sessionId, documentPath));
    if (failures?.fingerprint === fingerprint && failures.count >= 3) {
      return {
        envelope: errorEnvelope(
          metadata.version,
          metadata.schemaCrc,
          cliArgv,
          cwd,
          structuredError(
            'loop_prevented',
            'conflict',
            'The same OfficeCLI request failed three consecutive times for this artifact revision.',
            { recovery: 'Change the arguments based on the original upstream error instead of repeating the same call.' },
          ),
          Math.max(0, now() - startedAt),
          documentPath,
        ),
        stdout: '', stderr: '', exitCode: null, cwd, binary: runtime.path,
      };
    }

    const timeoutMs = normalizeTimeout(request.timeoutMs);
    const elapsed = Math.max(0, now() - startedAt);
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      return {
        envelope: errorEnvelope(
          metadata.version,
          metadata.schemaCrc,
          cliArgv,
          cwd,
          structuredError('timeout', 'timeout', `OfficeCLI exceeded the ${timeoutMs}ms timeout during metadata validation.`, {
            retriable: true,
            recovery: 'Retry with a larger timeoutMs.',
          }),
          elapsed,
          documentPath,
        ),
        stdout: '', stderr: '', exitCode: null, cwd, binary: runtime.path,
      };
    }
    const result = await runner(runtime.path, cliArgv, {
      cwd,
      env: buildOfficeEnvironment(),
      timeoutMs: remaining,
    });
    const durationMs = Math.max(0, now() - startedAt);
    if (result.timedOut) {
      const envelope = errorEnvelope(
        metadata.version,
        metadata.schemaCrc,
        cliArgv,
        cwd,
        structuredError('timeout', 'timeout', `OfficeCLI exceeded the ${timeoutMs}ms timeout.`, {
          retriable: true,
          recovery: 'Use a narrower operation or increase timeoutMs.',
        }),
        durationMs,
        documentPath,
      );
      return { envelope, ...result, cwd, binary: runtime.path };
    }
    const parsed = parseJson(result.stdout);
    const upstreamSuccess = extractSuccess(parsed);
    const appliedWithCaveats = result.exitCode === 2 && upstreamSuccess !== false && result.stdout.trim().length > 0;
    const ok = (result.exitCode === 0 || appliedWithCaveats) && upstreamSuccess !== false;
    const warnings = extractWarnings(parsed, result.stderr, result.truncated);
    if (appliedWithCaveats) {
      warnings.push({
        code: 'applied_with_caveats',
        message: 'OfficeCLI applied the operation but reported unsupported properties or other caveats.',
        severity: 'high',
      });
    }
    if (!ok) {
      const key = failureKey(ctx.sessionId, documentPath);
      const previous = failureStates.get(key);
      failureStates.set(key, {
        fingerprint,
        count: previous?.fingerprint === fingerprint ? previous.count + 1 : 1,
      });
      const error = upstreamError(parsed, result.stderr.trim() || result.stdout.trim());
      const envelope: OfficeResultEnvelope = {
        ...errorEnvelope(metadata.version, metadata.schemaCrc, cliArgv, cwd, error, durationMs, documentPath),
        warnings,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
      return { envelope, ...result, cwd, binary: runtime.path };
    }
    failureStates.delete(failureKey(ctx.sessionId, documentPath));
    const mutates = request.mutation ?? request.mode === 'edit';
    const revision = documentPath
      ? mutates
        ? markMutation(documentPath, ctx.sessionId)
        : getOfficeArtifactRevision(documentPath)
      : undefined;
    const artifact = documentPath ? documentArtifact(documentPath, revision) : undefined;
    const data = extractData(parsed);
    const envelope: OfficeResultEnvelope = {
      ok: true,
      version: metadata.version,
      schemaCrc: metadata.schemaCrc,
      command: cliArgv,
      cwd,
      ...(documentPath ? { documentPath } : {}),
      durationMs,
      data,
      ...(extractBackend(parsed) ? { backend: extractBackend(parsed) } : {}),
      warnings,
      cacheHit: false,
      ...(revision !== undefined ? { artifactRevision: revision } : {}),
      artifacts: artifact ? [artifact] : [],
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
    if (shouldCache) inspectCache.set(resultCacheKey, envelope);
    return { envelope, ...result, cwd, binary: runtime.path };
  } catch (error) {
    const envelope = errorEnvelope(
      expectedVersion,
      expectedSchema,
      argv,
      cwd,
      thrownOfficeError(error),
      Math.max(0, now() - startedAt),
      documentPath,
    );
    return { envelope, stdout: '', stderr: '', exitCode: null, cwd };
  }
}

export function clearOfficeRuntimeState(): void {
  metadataCache.clear();
  runtimeIntegrityCache.clear();
  artifactStates.clear();
  inspectCache.clear();
  failureStates.clear();
  mutatedBySession.clear();
}

export function releaseOfficeRuntimeSession(sessionId: string): void {
  const prefix = `${sessionId}\0`;
  for (const key of inspectCache.keys()) {
    if (key.startsWith(prefix)) inspectCache.delete(key);
  }
  for (const key of failureStates.keys()) {
    if (key.startsWith(prefix)) failureStates.delete(key);
  }
  for (const key of mutatedBySession) {
    if (key.startsWith(prefix)) mutatedBySession.delete(key);
  }
}
