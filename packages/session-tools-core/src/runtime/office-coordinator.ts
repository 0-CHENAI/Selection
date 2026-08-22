import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import {
  accessSync,
  constants,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type {
  ArtifactRef,
  OfficeErrorCategory,
  OfficeResultEnvelope,
  OfficeStructuredError,
  StructuredWarning,
} from '../office-types.ts';
import type { ToolContent, ToolResult } from '../types.ts';
import {
  isPathWithinDirectory,
  isPathWithinDirectoryForCreation,
} from './path-security.ts';
import { resolveOfficecliRuntime } from './officecli.ts';
import {
  diagnoseOfficecliResourceFailure,
  logOfficecliResourceFailure,
  resolveOfficecliResources,
  reviewedOfficecliSchemaCrc,
} from './office-manifest.ts';
import { OFFICE_STANDARD_TASK_HINT } from '../office-standard-task.ts';
import { forbiddenCommandRecovery } from './office-skill-bootstrap.ts';
import { validateMorphGlb } from './office-recipes.ts';
import {
  attachOfficeResidentSession,
  bindOfficeResidentRunner,
  buildOfficeEnvironment as buildOfficeResidentEnvironment,
  clearOfficeResidentLeases,
  closeOfficeResidentLease,
  detachOfficeResidentSession,
  hasOpenOfficeResidentLease,
  markOfficeResidentOpened,
  runExclusiveOfficeLease,
  type OfficeResidentMode,
} from './office-resident.ts';

export { hasOpenOfficeResidentLease };

export const OFFICE_DEFAULT_TIMEOUT_MS = 120_000;
export const OFFICE_MAX_TIMEOUT_MS = 300_000;
export const OFFICE_MAX_INLINE_BATCH_COMMANDS = 200;
export const OFFICE_MAX_INLINE_BATCH_CHARS = 500_000;
export const OFFICE_MAX_BATCH_FILE_BYTES = 5_000_000;

const METADATA_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_CHARS = 500_000;
const MAX_PATH_LENGTH = 4096;
const OFFICE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx']);
const OFFICE_DOCUMENT_TYPES = new Set(['docx', 'xlsx', 'pptx']);
const DOCUMENTLESS_COMMANDS = new Set(['status', 'help']);
const JSON_FLAGS = new Set(['--json']);
const INSPECT_ALWAYS_FORBIDDEN_FLAGS = new Set([
  '--browser', '--jsonl', '--save', '--force',
]);
const INSPECT_OUTPUT_FLAGS = new Set(['--out', '-o', '--output']);
const BATCH_SOURCE_FLAGS = new Set(['--commands', '--input']);
const PREVIEW_ONLY_VIEW_MODES = new Set(['svg', 'g', 'screenshot', 'pdf', 'forms']);
const INSPECT_ARTIFACT_VIEW_MODES = new Set(['html', 'h', 'annotated']);
const RENDERING_VIEW_MODES = new Set(['html', 'h', 'svg', 'g', 'screenshot', 'pdf', 'forms']);
const LIFECYCLE_COMMANDS = new Set(['open', 'save', 'close']);
const SKIP_RESIDENT_COMMANDS = new Set(['status', 'help', 'create', 'merge']);
const PICTURE_ELEMENT_TYPES = new Set(['picture', 'image', 'img']);
const OLE_ELEMENT_TYPES = new Set(['ole', 'oleobject', 'object', 'embed']);
const DIAGRAM_ELEMENT_TYPES = new Set(['diagram', 'flowchart']);
const MARKDOWN_ELEMENT_TYPES = new Set(['markdown', 'md']);
const MEDIA_ELEMENT_TYPES = new Set(['video', 'audio', 'media']);
const IMAGE_FILL_ELEMENT_TYPES = new Set(['shape', 'textbox', 'placeholder', 'ph', 'cell', 'tc']);
const CLEARABLE_IMAGE_VALUES = new Set(['none', 'clear']);
const MORPH_3D_ELEMENT_TYPES = new Set(['3dmodel', 'model3d', 'model', 'glb']);
const MORPH_3D_SOURCE_PROPS = new Set(['path', 'src']);
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
  /** Only the Selection lease manager may run open/save/close. */
  allowLifecycle?: boolean;
  /** Run this command without attaching or using a resident lease. */
  skipResident?: boolean;
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
  /** Test override. Production uses desktop Word on Windows only. */
  nativeScreenshotAvailable?: boolean;
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
const sessionStatusCache = new Map<string, OfficeResultEnvelope>();
const sessionDocumentPaths = new Map<string, string>();

const STATUS_ALREADY_PROVIDED: StructuredWarning = {
  code: 'status_already_provided',
  message: 'OfficeCLI status was already resolved for this session.',
  recovery: 'Reuse envelope.cwd, envelope.documentPath, and the previous status payload.',
  severity: 'low',
};

function attachSessionDocument(
  envelope: OfficeResultEnvelope,
  sessionId: string,
  cwd: string,
): OfficeResultEnvelope {
  const lastDocumentPath = sessionDocumentPaths.get(sessionId);
  const data = envelope.data && typeof envelope.data === 'object'
    ? { ...envelope.data as Record<string, unknown> }
    : {};
  return {
    ...envelope,
    cwd,
    documentPath: lastDocumentPath,
    data: {
      ...data,
      workingDirectory: cwd,
      lastDocumentPath,
    },
  };
}

function reusedStatusOutcome(
  cached: OfficeResultEnvelope,
  sessionId: string,
  cwd: string,
  durationMs: number,
  binary: string,
): OfficeExecutionOutcome {
  return {
    envelope: {
      ...attachSessionDocument(cached, sessionId, cwd),
      cacheHit: true,
      durationMs,
      warnings: [...cached.warnings, STATUS_ALREADY_PROVIDED],
    },
    stdout: cached.version,
    stderr: '',
    exitCode: 0,
    cwd,
    binary,
  };
}

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

export function buildOfficeEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
  mode: OfficeResidentMode = 'standalone',
): NodeJS.ProcessEnv {
  return buildOfficeResidentEnvironment(baseEnv, mode);
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

function ensureOutputTarget(path: string, argv: string[]): void {
  if (!existsSync(path)) return;
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    throw structuredError(
      'output_target_unavailable',
      'path',
      `Cannot inspect existing output ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!stats.isFile()) {
    throw structuredError('output_target_not_file', 'path', `Existing output target is not a regular file: ${path}`);
  }
  if (!hasFlag(argv, '--force')) {
    throw structuredError(
      'output_exists',
      'conflict',
      `Output file already exists: ${path}`,
      { recovery: 'Choose a new output path or explicitly add --force.' },
    );
  }
  try {
    accessSync(path, constants.W_OK);
  } catch {
    throw structuredError('output_not_writable', 'permission', `Existing output file is not writable: ${path}`);
  }
}

function pathsReferToSameExistingFile(first: string, second: string): boolean {
  if (first === second) return true;
  try {
    const firstStats = statSync(first);
    const secondStats = statSync(second);
    return firstStats.dev === secondStats.dev && firstStats.ino === secondStats.ino;
  } catch {
    return false;
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

function singleOptionValue(argv: string[], option: string): string | undefined {
  const values = optionValues(argv, option);
  if (values.length > 1) {
    throw structuredError(
      'duplicate_option',
      'input',
      `OfficeCLI option '${option}' may be provided at most once.`,
    );
  }
  const bareIndex = argv.indexOf(option);
  if (bareIndex >= 0 && (!argv[bareIndex + 1] || argv[bareIndex + 1]!.startsWith('-'))) {
    throw structuredError('missing_option_value', 'input', `OfficeCLI option '${option}' requires a value.`);
  }
  return values[0];
}

interface OfficeImportSpec {
  sourcePath: string;
  parentPath: string;
  delimiter?: ',' | '\t';
  format: 'csv' | 'tsv' | 'json';
  header: boolean;
  startCell: string;
  startColumn: number;
  startRow: number;
}

interface OfficeImportRecipe extends OfficeImportSpec {
  rows: number;
  columns: number;
  commands: Array<Record<string, unknown>>;
  serialized: string;
}

function excelColumnIndex(name: string): number {
  let index = 0;
  for (const character of name) index = (index * 26) + character.charCodeAt(0) - 64;
  return index;
}

function excelColumnName(index: number): string {
  let name = '';
  let remaining = index;
  while (remaining > 0) {
    remaining -= 1;
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26);
  }
  return name;
}

function validateOfficeImportGrammar(argv: string[]): string | undefined {
  const seen = new Set<string>();
  let positionalSource: string | undefined;
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('-')) {
      if (!seen.has('positional-source')) {
        seen.add('positional-source');
        positionalSource = token;
        continue;
      }
      throw structuredError('invalid_import_argument', 'input', `Unexpected import argument '${token}'.`);
    }
    const flag = flagName(token);
    if (!['--file', '--format', '--header', '--start-cell', '--stdin', '--json'].includes(flag)) {
      throw structuredError('invalid_import_argument', 'input', `Unsupported import option '${flag}'.`);
    }
    if (seen.has(flag)) {
      throw structuredError('duplicate_option', 'input', `OfficeCLI option '${flag}' may be provided at most once.`);
    }
    seen.add(flag);
    if (flag === '--file' || flag === '--format' || flag === '--start-cell') {
      if (token === flag) index += 1;
    } else if (token !== flag) {
      throw structuredError('invalid_import_argument', 'input', `OfficeCLI flag '${flag}' does not accept a value.`);
    }
  }
  return positionalSource;
}

function resolveOfficeImportSpec(argv: string[], cwd: string, roots: string[]): OfficeImportSpec {
  const positionalFile = validateOfficeImportGrammar(argv);
  if (extname(argv[1] ?? '').toLowerCase() !== '.xlsx') {
    throw structuredError(
      'import_requires_xlsx',
      'unsupported',
      'OfficeCLI import only supports .xlsx target documents.',
    );
  }
  const parentPath = argv[2]?.trim();
  if (!parentPath || !/^\/[^/]+$/.test(parentPath)) {
    throw structuredError(
      'invalid_import_parent',
      'input',
      'import requires one sheet path such as /Sheet1 as its parent path.',
    );
  }
  if (hasFlag(argv, '--stdin')) {
    throw structuredError(
      'stdin_not_supported',
      'unsupported',
      'office_document_edit does not accept raw stdin. Write the CSV/TSV/JSON data to an authorized file, then import that file.',
    );
  }
  const optionFile = singleOptionValue(argv, '--file');
  if (optionFile && positionalFile) {
    throw structuredError(
      'ambiguous_import_source',
      'input',
      'import accepts either the positional source file or --file, not both.',
    );
  }
  const rawSource = optionFile ?? positionalFile;
  if (!rawSource) {
    throw structuredError(
      'import_source_required',
      'input',
      'import requires an authorized CSV/TSV/JSON source file.',
    );
  }
  const sourcePath = resolveArgumentPath(rawSource, cwd);
  ensureExistingFile(sourcePath, roots);

  const explicitFormat = singleOptionValue(argv, '--format')?.toLowerCase();
  if (explicitFormat && explicitFormat !== 'csv' && explicitFormat !== 'tsv' && explicitFormat !== 'json') {
    throw structuredError('invalid_import_format', 'input', "import --format must be csv, tsv, or json.");
  }
  const sourceExtension = extname(sourcePath).toLowerCase();
  const inferredFormat = sourceExtension === '.tsv'
    ? 'tsv'
    : sourceExtension === '.json'
      ? 'json'
      : sourceExtension === '.csv'
        ? 'csv'
        : undefined;
  const format = (explicitFormat ?? inferredFormat) as 'csv' | 'tsv' | 'json' | undefined;
  if (!format) {
    throw structuredError(
      'import_format_required',
      'input',
      'Cannot infer CSV/TSV/JSON format from the source extension; provide --format csv, tsv, or json.',
    );
  }

  const startCell = (singleOptionValue(argv, '--start-cell') ?? 'A1').toUpperCase();
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(startCell);
  if (!match) {
    throw structuredError('invalid_import_start_cell', 'input', 'import --start-cell must be an A1-style cell reference.');
  }
  const startColumn = excelColumnIndex(match[1]!);
  const startRow = Number(match[2]);
  if (startColumn > 16_384 || startRow > 1_048_576) {
    throw structuredError('invalid_import_start_cell', 'input', 'import --start-cell is outside Excel worksheet bounds.');
  }
  return {
    sourcePath,
    parentPath,
    format,
    header: hasFlag(argv, '--header'),
    startCell,
    startColumn,
    startRow,
    ...(format === 'tsv' ? { delimiter: '\t' as const } : format === 'csv' ? { delimiter: ',' as const } : {}),
  };
}

function parseOfficeImportRows(source: string, spec: OfficeImportSpec): string[][] {
  if (spec.format !== 'json') {
    if (!spec.delimiter) {
      throw structuredError('import_format_required', 'input', 'CSV/TSV import is missing a delimiter.');
    }
    return parseDelimitedOfficeRows(source, spec.delimiter);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw structuredError(
      'invalid_import_data',
      'input',
      `JSON import source is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (Array.isArray(parsed) && parsed.every(row => Array.isArray(row))) {
    return parsed.map(row => (row as unknown[]).map(cell => cell == null ? '' : String(cell)));
  }
  if (Array.isArray(parsed) && parsed.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
    const keys = [...new Set(parsed.flatMap(row => Object.keys(row as Record<string, unknown>)))];
    const rows = parsed.map(row => keys.map(key => {
      const value = (row as Record<string, unknown>)[key];
      return value == null ? '' : String(value);
    }));
    return spec.header ? [keys, ...rows] : rows;
  }
  throw structuredError(
    'invalid_import_data',
    'input',
    'JSON import source must be an array of arrays or an array of objects.',
  );
}

function parseDelimitedOfficeRows(raw: string, delimiter: ',' | '\t'): string[][] {
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let endedWithNewline = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    endedWithNewline = false;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      endedWithNewline = true;
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw structuredError('invalid_import_data', 'input', 'CSV/TSV source ends inside an unterminated quoted field.');
  }
  if (!endedWithNewline || row.length > 0 || field.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

interface OfficeImportSource {
  spec: OfficeImportSpec;
  rows: string[][];
  columns: number;
}

function loadReviewedImportSource(
  argv: string[],
  ctx: SessionToolContext,
  cwd: string,
  maxSourceBytes: number,
): OfficeImportSource {
  const roots = allowedRoots(ctx, cwd);
  const spec = resolveOfficeImportSpec(argv, cwd, roots);
  const sourceStats = statSync(spec.sourcePath);
  if (sourceStats.size > maxSourceBytes) {
    throw structuredError(
      'import_recipe_too_large',
      'unsupported',
      `The reviewed OfficeCLI import recovery is limited to ${maxSourceBytes} source bytes.`,
      { recovery: 'Split the source into smaller imports or upgrade to a reviewed OfficeCLI version with a verified native import.' },
    );
  }
  let source: string;
  try {
    source = readFileSync(spec.sourcePath, 'utf8');
  } catch (error) {
    throw structuredError(
      'import_source_unreadable',
      'permission',
      `Cannot read import source ${spec.sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (source.includes('\0')) {
    throw structuredError('invalid_import_data', 'input', 'CSV/TSV/JSON source contains NUL bytes and is not valid text data.');
  }
  const rows = parseOfficeImportRows(source, spec);
  const columns = rows.reduce((maximum, current) => Math.max(maximum, current.length), 0);
  if (rows.length === 0 || columns === 0) {
    throw structuredError('empty_import_source', 'input', 'CSV/TSV/JSON source contains no cells to import.');
  }
  const lastRow = spec.startRow + rows.length - 1;
  const lastColumn = spec.startColumn + columns - 1;
  if (lastRow > 1_048_576 || lastColumn > 16_384) {
    throw structuredError('import_exceeds_sheet_bounds', 'input', 'Imported data would exceed Excel worksheet bounds.');
  }
  return { spec, rows, columns };
}

function materializeReviewedImportRecipe(
  source: OfficeImportSource,
  maxSourceBytes: number,
): OfficeImportRecipe {
  const { spec, rows, columns } = source;
  const lastRow = spec.startRow + rows.length - 1;
  const lastColumn = spec.startColumn + columns - 1;
  const commands: Array<Record<string, unknown>> = [];
  rows.forEach((cells, rowOffset) => {
    cells.forEach((value, columnOffset) => {
      const cell = `${excelColumnName(spec.startColumn + columnOffset)}${spec.startRow + rowOffset}`;
      commands.push({
        command: 'set',
        path: `${spec.parentPath}/${cell}`,
        props: { value },
      });
    });
  });
  if (spec.header) {
    commands.push({
      command: 'set',
      path: spec.parentPath,
      props: {
        freeze: `A${Math.min(spec.startRow + 1, 1_048_576)}`,
        autoFilter: `${spec.startCell}:${excelColumnName(lastColumn)}${lastRow}`,
      },
    });
  }
  const serialized = JSON.stringify(commands);
  if (Buffer.byteLength(serialized, 'utf8') > maxSourceBytes) {
    throw structuredError(
      'import_recipe_too_large',
      'unsupported',
      `The reviewed OfficeCLI atomic import recipe exceeds ${maxSourceBytes} bytes.`,
      { recovery: 'Split the source into smaller imports or upgrade to a reviewed OfficeCLI version with a verified native import.' },
    );
  }
  return { ...spec, rows: rows.length, columns, commands, serialized };
}

function normalizeOfficeDocumentArgv(argv: string[]): string[] {
  const normalized = [...argv];
  const command = normalized[0]?.trim().toLowerCase() ?? '';
  if (DOCUMENTLESS_COMMANDS.has(command)) return normalized;

  const document = normalized[1];
  if (!document || document.startsWith('-')) {
    throw structuredError('file_required', 'input', `OfficeCLI command '${command}' requires an Office document path.`);
  }

  if (command === 'create') {
    const typeValues = optionValues(normalized, '--type');
    if (typeValues.length > 1) {
      throw structuredError('duplicate_document_type', 'input', 'create accepts at most one --type value.');
    }
    const explicitType = typeValues[0]?.trim().toLowerCase();
    if (explicitType && !OFFICE_DOCUMENT_TYPES.has(explicitType)) {
      throw structuredError(
        'unsupported_document_type',
        'unsupported',
        `Unsupported Office document type: ${explicitType}.`,
        { recovery: 'Use docx, xlsx, or pptx.' },
      );
    }
    let extension = extname(document).toLowerCase();
    if (!extension) {
      if (!explicitType || /[\\/]$/.test(document)) {
        throw structuredError(
          'document_extension_required',
          'input',
          'create requires a .docx/.xlsx/.pptx output path, or --type so Selection can resolve the exact output path.',
        );
      }
      normalized[1] = `${document}.${explicitType}`;
      extension = `.${explicitType}`;
    }
    if (!OFFICE_EXTENSIONS.has(extension)) {
      throw structuredError(
        'unsupported_document_extension',
        'unsupported',
        `Unsupported Office output extension: ${extension}.`,
        { recovery: 'Use .docx, .xlsx, or .pptx.' },
      );
    }
    if (explicitType && extension !== `.${explicitType}`) {
      throw structuredError(
        'document_type_mismatch',
        'input',
        `create output extension ${extension} conflicts with --type ${explicitType}.`,
      );
    }
    return normalized;
  }

  const documentExtension = extname(document).toLowerCase();
  if (!OFFICE_EXTENSIONS.has(documentExtension)) {
    throw structuredError(
      'unsupported_document_extension',
      'unsupported',
      `OfficeCLI command '${command}' requires a .docx, .xlsx, or .pptx document path.`,
    );
  }

  if (command === 'merge') {
    const output = normalized[2];
    if (!output || output.startsWith('-')) {
      throw structuredError('output_required', 'input', 'merge requires an explicit Office output path.');
    }
    const outputExtension = extname(output).toLowerCase();
    if (!OFFICE_EXTENSIONS.has(outputExtension)) {
      throw structuredError(
        'unsupported_document_extension',
        'unsupported',
        'merge output must end in .docx, .xlsx, or .pptx.',
      );
    }
    if (outputExtension !== documentExtension) {
      throw structuredError(
        'document_type_mismatch',
        'input',
        `merge cannot write a ${documentExtension} template to a ${outputExtension} output; OfficeCLI would leave a corrupt partial file.`,
        { recovery: `Use an output path ending in ${documentExtension}.` },
      );
    }
  }
  return normalized;
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

function validateMorphGlbProperty(
  elementType: string,
  name: string,
  rawValue: unknown,
  cwd: string,
  roots: string[],
): boolean {
  if (!MORPH_3D_ELEMENT_TYPES.has(elementType) || !MORPH_3D_SOURCE_PROPS.has(name) || typeof rawValue !== 'string') {
    return false;
  }
  const value = rawValue.trim();
  if (!value) return true;
  if (isRemoteOrEmbeddedResource(value)) {
    throw structuredError(
      'remote_morph_glb_forbidden',
      'permission',
      'Morph 3D models must use a validated local .glb inside the authorized workspace or session path.',
    );
  }
  ensureMorphGlbInput(value, cwd, roots);
  return true;
}

function validateLocalResourceValue(
  rawValue: string,
  cwd: string,
  roots: string[],
  options: { onlyWhenExisting?: boolean } = {},
): void {
  const value = rawValue.trim();
  if (!value || isRemoteOrEmbeddedResource(value)) return;
  if (options.onlyWhenExisting && !existsSync(resolveArgumentPath(value, cwd))) return;
  ensureLocalInput(value, cwd, roots);
}

function targetEndsWithElement(targetPath: string, names: string[]): boolean {
  const alternatives = names.join('|');
  return new RegExp(`/(?:${alternatives})\\[[^\\]]+\\]/?$`, 'i').test(targetPath);
}

function isExcelCellTarget(targetPath: string): boolean {
  // Excel worksheet names cannot contain '/', so the final segment can be
  // classified without attempting to parse OfficeCLI's complete path grammar.
  return /^\/[^/]+\/[A-Z]{1,3}[1-9]\d*$/i.test(targetPath);
}

function isSetLocalResourceProperty(
  documentExtension: string,
  targetPath: string,
  name: string,
  value: string,
): boolean {
  if (documentExtension === '.docx') {
    // Word dispatches these properties on a run after inspecting whether it
    // contains a Drawing or OLE object; the path alone cannot distinguish it.
    return name === 'path' || name === 'src' || name === 'icon';
  }

  if (documentExtension === '.xlsx') {
    if (targetEndsWithElement(targetPath, ['ole', 'object', 'embed'])) {
      return name === 'path' || name === 'src';
    }
    return isExcelCellTarget(targetPath)
      && name === 'image'
      && !CLEARABLE_IMAGE_VALUES.has(value.toLowerCase());
  }

  if (documentExtension !== '.pptx') return false;

  if (targetEndsWithElement(targetPath, ['picture', 'pic', 'ole', 'object', 'embed'])) {
    return name === 'path' || name === 'src';
  }
  if (targetEndsWithElement(targetPath, ['zoom'])) {
    return name === 'image' || name === 'path' || name === 'src' || name === 'cover';
  }
  if (targetEndsWithElement(targetPath, ['video', 'audio'])) {
    return name === 'poster';
  }
  if (targetEndsWithElement(targetPath, ['shape', 'textbox', 'placeholder', 'ph', 'title'])) {
    return (name === 'image' || name === 'imagefill')
      && !CLEARABLE_IMAGE_VALUES.has(value.toLowerCase());
  }
  return false;
}

/**
 * Validate only properties that the pinned OfficeCLI handlers actually open as
 * files. Property names are not globally file-like: for example, `src` is an
 * Excel pivot range and `poster=true` is a diagram layout mode. Keeping this
 * dispatch type-aware prevents both local-file escapes and false rejections of
 * valid native OfficeCLI commands.
 */
function validateOfficePropertyInput(
  command: string,
  elementType: string,
  name: string,
  rawValue: unknown,
  documentExtension: string,
  targetPath: string,
  cwd: string,
  roots: string[],
): void {
  if (validateMorphGlbProperty(elementType, name, rawValue, cwd, roots)) return;
  if (typeof rawValue !== 'string') return;

  const value = rawValue.trim();
  if (!value) return;

  // Slide and master/layout backgrounds encode the resource inside the value
  // (`background=image:/path/to/file.png`) rather than in the property name.
  if (name === 'background' && /^image:/i.test(value)) {
    validateLocalResourceValue(value.slice(value.indexOf(':') + 1), cwd, roots);
    return;
  }

  if (command === 'set') {
    if (isSetLocalResourceProperty(documentExtension, targetPath, name, value)) {
      validateLocalResourceValue(value, cwd, roots);
    }
    return;
  }

  if (command !== 'add') return;

  if (PICTURE_ELEMENT_TYPES.has(elementType)) {
    if (name === 'path' || name === 'src' || name === 'fallback') {
      validateLocalResourceValue(value, cwd, roots);
    }
    return;
  }
  if (OLE_ELEMENT_TYPES.has(elementType)) {
    if (name === 'path' || name === 'src' || name === 'icon' || name === 'preview') {
      validateLocalResourceValue(value, cwd, roots);
    }
    return;
  }
  if (DIAGRAM_ELEMENT_TYPES.has(elementType) || MARKDOWN_ELEMENT_TYPES.has(elementType)) {
    if (name === 'path' || name === 'src') validateLocalResourceValue(value, cwd, roots);
    return;
  }
  if (MEDIA_ELEMENT_TYPES.has(elementType)) {
    if (name === 'path' || name === 'src' || name === 'poster') {
      validateLocalResourceValue(value, cwd, roots);
    }
    return;
  }
  if (IMAGE_FILL_ELEMENT_TYPES.has(elementType)) {
    if ((name === 'image' || name === 'imagefill') && !CLEARABLE_IMAGE_VALUES.has(value.toLowerCase())) {
      validateLocalResourceValue(value, cwd, roots);
    }
    return;
  }
  if ((elementType === 'table' || elementType === 'tbl')
      && name === 'data'
      && documentExtension !== '.xlsx') {
    // Word/PPT tables treat an existing local path as CSV and otherwise treat
    // the same string as inline cell data. Mirror that distinction exactly.
    validateLocalResourceValue(value, cwd, roots, { onlyWhenExisting: true });
  }
}

function validateCommandInputResources(
  argv: string[],
  command: string,
  cwd: string,
  roots: string[],
): void {
  if (command === 'import') {
    resolveOfficeImportSpec(argv, cwd, roots);
  }

  if (command === 'merge') {
    const data = optionValues(argv, '--data')[0];
    if (data && !data.trim().startsWith('{') && !data.trim().startsWith('[')) {
      ensureLocalInput(data, cwd, roots);
    }
  }

  if (command === 'add' || command === 'set') {
    const elementType = optionValues(argv, '--type')[0]?.toLowerCase();
    const documentExtension = extname(argv[1] ?? '').toLowerCase();
    for (const prop of optionValues(argv, '--prop')) {
      const separator = prop.indexOf('=');
      if (separator <= 0) continue;
      const name = prop.slice(0, separator).trim().toLowerCase();
      const value = prop.slice(separator + 1).trim();
      validateOfficePropertyInput(
        command,
        elementType ?? '',
        name,
        value,
        documentExtension,
        argv[2] ?? '',
        cwd,
        roots,
      );
    }
  }
}

function officePathTokens(argv: string[]): Array<{ index: number; value: string; path: string }> {
  const command = argv[0]?.trim().toLowerCase();
  const positions = command === 'merge' ? [1, 2] : DOCUMENTLESS_COMMANDS.has(command ?? '') ? [] : [1];
  return positions.flatMap(index => {
    const value = argv[index];
    return value ? [{ index, value, path: value }] : [];
  });
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
    ensureOutputTarget(output, argv);
    return output;
  }
  if (command === 'merge') {
    const template = tokens[0]?.path;
    const output = tokens[1]?.path;
    if (template) ensureExistingFile(template, roots);
    // Validate every read input before mkdir has any observable side effect.
    // A missing or unauthorized data source must not leave an empty output
    // directory behind.
    validateCommandInputResources(argv, command, cwd, roots);
    if (output) {
      if (template && pathsReferToSameExistingFile(template, output)) {
        throw structuredError(
          'output_conflicts_with_input',
          'conflict',
          'merge output must not overwrite its template input in place.',
          { recovery: 'Choose a distinct output path, then replace the template only after successful finalization.' },
        );
      }
      ensureOutputParent(output, roots);
      ensureOutputTarget(output, argv);
    }
    return output ?? template;
  }
  const document = tokens[0]?.path;
  if (document) ensureExistingFile(document, roots);
  validateCommandInputResources(argv, command, cwd, roots);
  if (command === 'view' || command === 'dump') {
    const output = optionValues(argv, '--out')[0] ?? optionValues(argv, '-o')[0] ?? optionValues(argv, '--output')[0];
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
  documentExtension: string,
  cwd: string,
  roots: string[],
): void {
  for (const [index, item] of items.entries()) {
    const fields = new Map<string, { original: string; value: unknown }>();
    let duplicateField: string | undefined;
    for (const [field, value] of Object.entries(item)) {
      const normalized = field.toLowerCase();
      if (fields.has(normalized)) {
        duplicateField = field;
        break;
      }
      fields.set(normalized, { original: field, value });
    }
    if (duplicateField) {
      throw structuredError(
        'duplicate_batch_field',
        'input',
        `Batch item ${index} repeats a field with different casing: ${duplicateField}.`,
        { recovery: 'Provide each case-insensitive batch field exactly once.' },
      );
    }
    const unknownField = [...fields.entries()].find(([field]) => !BATCH_ALLOWED_FIELDS.has(field))?.[1].original;
    if (unknownField) {
      throw structuredError(
        'unknown_batch_field',
        'input',
        `Batch item ${index} contains an unsupported field: ${unknownField}.`,
        { recovery: 'Use only fields declared by the pinned OfficeCLI batch schema.' },
      );
    }
    if (fields.has('command') && fields.has('op')) {
      throw structuredError(
        'ambiguous_batch_command',
        'input',
        `Batch item ${index} provides both command and op.`,
        { recovery: 'Use exactly one command verb field; command is preferred.' },
      );
    }
    const commandValue = fields.get('command')?.value ?? fields.get('op')?.value;
    const rawCommand = typeof commandValue === 'string'
      ? commandValue
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
      const modeValue = fields.get('mode')?.value;
      const mode = typeof modeValue === 'string' ? modeValue.trim().toLowerCase() : 'text';
      if (RENDERING_VIEW_MODES.has(mode)) {
        throw structuredError(
          'batch_render_requires_preview',
          'unsupported',
          `Batch item ${index} requests view mode '${mode}', which belongs to office_document_preview.render.`,
        );
      }
    }
    if (command === 'add' || command === 'set') {
      const elementType = String(fields.get('type')?.value ?? '').trim().toLowerCase();
      const props = fields.get('props')?.value;
      const targetPath = fields.get('path')?.value;
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
        validateOfficePropertyInput(
          command,
          elementType,
          name.toLowerCase(),
          rawValue,
          documentExtension,
          typeof targetPath === 'string' ? targetPath : '',
          cwd,
          roots,
        );
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
    validateNestedBatchCommands(items, extname(argv[1] ?? '').toLowerCase(), cwd, roots);
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
  validateNestedBatchCommands(
    items as Array<Record<string, unknown>>,
    extname(argv[1] ?? '').toLowerCase(),
    cwd,
    roots,
  );
  return [...argv, '--input', file];
}

function validateArgv(argv: unknown, timeoutMs: unknown): asserts argv is string[] {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(token => typeof token !== 'string' || token.includes('\0'))) {
    throw structuredError('invalid_argv', 'input', 'argv must be a non-empty array of native OfficeCLI string tokens.');
  }
  const command = argv[0]!.trim();
  if (command.toLowerCase() === 'officecli' || command.toLowerCase() === 'officecli.exe') {
    throw structuredError('binary_prefix_forbidden', 'input', 'Remove the officecli binary prefix; argv starts with the command verb.');
  }
  if (command !== argv[0] || command !== command.toLowerCase()) {
    throw structuredError(
      'invalid_command_token',
      'input',
      'The OfficeCLI command verb must be lowercase and must not contain surrounding whitespace.',
      { recovery: `Use '${command.toLowerCase()}' as argv[0].` },
    );
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
  allowLifecycle = false,
): void {
  const command = argv[0]!.trim().toLowerCase();
  if (allowLifecycle && LIFECYCLE_COMMANDS.has(command)) return;
  if (IMMUTABLE_FORBIDDEN_COMMANDS.has(command)) {
    throw structuredError(
      'management_command_forbidden',
      'unsupported',
      `OfficeCLI command '${command}' is managed by Selection and is never exposed to agents.`,
      { recovery: forbiddenCommandRecovery(command) },
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
      { recovery: forbiddenCommandRecovery(command) },
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
    const forbidden = argv.find(token => INSPECT_ALWAYS_FORBIDDEN_FLAGS.has(flagName(token)));
    if (forbidden) {
      throw structuredError(
        'read_output_forbidden',
        'input',
        `Read-only inspection does not allow '${forbidden}'. Use office_document_preview for rendering.`,
      );
    }
    const outputFlag = argv.find(token => INSPECT_OUTPUT_FLAGS.has(flagName(token)));
    if (outputFlag && !isInspectArtifactCommand(argv)) {
      throw structuredError(
        'read_output_forbidden',
        'input',
        `Read-only inspection does not allow '${outputFlag}'. Use office_document_preview for rendering.`,
      );
    }
    if (command === 'view' && argv[2] && PREVIEW_ONLY_VIEW_MODES.has(argv[2].toLowerCase())) {
      throw structuredError(
        'render_requires_preview',
        'unsupported',
        `view ${argv[2]} belongs to office_document_preview.render.`,
      );
    }
  }
}

function isInspectArtifactCommand(argv: string[]): boolean {
  const command = argv[0]?.trim().toLowerCase();
  if (command === 'dump') return true;
  return command === 'view' && Boolean(argv[2] && INSPECT_ARTIFACT_VIEW_MODES.has(argv[2].toLowerCase()));
}

export function officeSessionArtifactDirectory(ctx: SessionToolContext, cwd: string): string {
  const root = ctx.dataPath
    ?? (ctx.sessionPath ? join(ctx.sessionPath, 'data') : join(ctx.workspacePath || cwd, 'data'));
  return join(root, 'office');
}

function inspectArtifactExtension(argv: string[]): string {
  if (argv[0] === 'dump') return 'json';
  const mode = argv[2]?.toLowerCase();
  if (mode === 'annotated') return 'txt';
  return 'html';
}

function prepareInspectArtifactOutput(
  ctx: SessionToolContext,
  argv: string[],
  mode: OfficeExecutionMode,
  cwd: string,
): string[] {
  if (mode !== 'inspect' || !isInspectArtifactCommand(argv)) return argv;
  const directory = officeSessionArtifactDirectory(ctx, cwd);
  const existing = singleOptionValue(argv, '--out')
    ?? singleOptionValue(argv, '-o')
    ?? singleOptionValue(argv, '--output');
  if (existing) {
    const resolved = resolveArgumentPath(existing, cwd);
    if (!isPathWithinDirectoryForCreation(resolved, directory)) {
      throw structuredError(
        'inspect_artifact_outside_office_dir',
        'permission',
        `inspect dump/view html --out must stay inside ${directory}.`,
        { recovery: 'Omit --out and let Selection write the artifact, or choose a path under session data/office/.' },
      );
    }
    mkdirSync(dirname(resolved), { recursive: true });
    return argv;
  }
  mkdirSync(directory, { recursive: true });
  const stem = basename(argv[1] ?? 'document', extname(argv[1] ?? ''));
  const output = join(directory, `${stem}-${randomUUID()}.${inspectArtifactExtension(argv)}`);
  return [...argv, '--out', output];
}

function inspectOutputPath(argv: string[], cwd: string): string | undefined {
  const raw = singleOptionValue(argv, '--out') ?? singleOptionValue(argv, '-o') ?? singleOptionValue(argv, '--output');
  return raw ? resolveArgumentPath(raw, cwd) : undefined;
}

function importProbeCellValue(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (typeof data !== 'object' || Array.isArray(data)) return '';
  const record = data as Record<string, unknown>;
  for (const key of ['value', 'text', 'content', 'v']) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return '';
}

function importContentPersisted(data: unknown, expected: string): boolean {
  if (!expected) return false;
  return importProbeCellValue(data) === expected;
}

function firstImportedCellValue(rows: string[][]): string {
  return rows[0]?.[0] ?? '';
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
  if (/unsupported|unavailable|not available|requires/.test(lower)) {
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

function syncOfficeArtifactStat(path: string): number {
  const canonical = existsSync(path) ? realpathSync.native(path) : resolve(path);
  const currentKey = statKey(canonical);
  const existing = artifactStates.get(canonical);
  if (!existing) {
    artifactStates.set(canonical, { revision: 1, statKey: currentKey });
    return 1;
  }
  existing.statKey = currentKey;
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

function shouldAttachResidentLease(
  request: OfficeExecutionRequest,
  argv: string[],
  documentPath: string | undefined,
): boolean {
  if (request.allowLifecycle || request.skipResident) return false;
  if (!documentPath || !existsSync(documentPath)) return false;
  const command = argv[0]?.trim().toLowerCase() ?? '';
  return !SKIP_RESIDENT_COMMANDS.has(command) && !DOCUMENTLESS_COMMANDS.has(command);
}

async function ensureResidentLeaseOpen(
  ctx: SessionToolContext,
  documentPath: string,
  runner: OfficecliProcessRunner,
  binary: string,
  cwd: string,
  timeoutMs: number,
): Promise<boolean> {
  return runExclusiveOfficeLease(documentPath, async () => {
    const lease = attachOfficeResidentSession(ctx.sessionId, documentPath);
    bindOfficeResidentRunner(documentPath, binary, cwd, runner);
    if (lease.opened) return true;
    const result = await runner(binary, ['open', documentPath, '--json'], {
      cwd,
      env: buildOfficeEnvironment(undefined, 'resident'),
      timeoutMs: Math.min(10_000, Math.max(1, timeoutMs)),
    });
    const parsed = parseJson(result.stdout);
    const ok = result.exitCode === 0 && extractSuccess(parsed) !== false && !result.timedOut;
    if (ok) {
      markOfficeResidentOpened(documentPath, true);
      return true;
    }
    return false;
  });
}

function resolveOfficeLeasePath(ctx: SessionToolContext, file: string): string {
  const cwd = chooseOfficeWorkingDirectory(ctx);
  return resolveArgumentPath(file, cwd);
}

export async function flushOfficeResidentLease(
  ctx: SessionToolContext,
  file: string,
  dependencies: OfficeCoordinatorDependencies = {},
): Promise<OfficeExecutionOutcome | undefined> {
  let resolved = file;
  try {
    resolved = resolveOfficeLeasePath(ctx, file);
  } catch {
    resolved = file;
  }
  if (!hasOpenOfficeResidentLease(resolved)) return undefined;
  return executeOfficeCommand(ctx, {
    argv: ['save', resolved],
    mode: 'internal',
    allowLifecycle: true,
    mutation: false,
    cacheable: false,
  }, dependencies);
}

function inspectArtifactRef(path: string): ArtifactRef | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return undefined;
    const extension = extname(path).toLowerCase();
    return {
      kind: extension === '.html' ? 'html' : 'resource',
      path,
      mimeType: extension === '.html'
        ? 'text/html'
        : extension === '.json'
          ? 'application/json'
          : 'text/plain',
      sizeBytes: stats.size,
    };
  } catch {
    return undefined;
  }
}

function shouldRetryWithoutResident(
  result: OfficecliProcessResult,
  error: OfficeStructuredError,
  mutates: boolean,
): boolean {
  if (error.code === 'file_busy') return true;
  if (result.timedOut || error.code === 'timeout') return !mutates;
  return false;
}

async function evictResidentLeaseForRetry(
  ctx: SessionToolContext,
  documentPath: string,
  runner: OfficecliProcessRunner,
  binary: string,
  cwd: string,
): Promise<void> {
  if (!hasOpenOfficeResidentLease(documentPath)) return;
  const lease = attachOfficeResidentSession(ctx.sessionId, documentPath);
  bindOfficeResidentRunner(documentPath, binary, cwd, runner);
  await closeOfficeResidentLease(lease);
  attachOfficeResidentSession(ctx.sessionId, documentPath);
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
    let resources;
    try {
      resources = (dependencies.resolveResources ?? resolveOfficecliResources)();
    } catch (error) {
      return {
        envelope: errorEnvelope(
          expectedVersion,
          expectedSchema,
          argv,
          cwd,
          structuredError(
            'officecli_manifest_invalid',
            'dependency',
            error instanceof Error ? error.message : String(error),
            { recovery: 'Reinstall Selection or rebuild the audited OfficeCLI resource bundle.' },
          ),
        ),
        stdout: '', stderr: '', exitCode: null, cwd,
      };
    }
    if (!resources) {
      const failure = diagnoseOfficecliResourceFailure();
      if (!dependencies.resolveResources) logOfficecliResourceFailure(failure);
      return {
        envelope: errorEnvelope(
          expectedVersion,
          expectedSchema,
          argv,
          cwd,
          structuredError(
            failure.code,
            'dependency',
            failure.message,
            { recovery: failure.recovery },
          ),
        ),
        stdout: '', stderr: '', exitCode: null, cwd,
      };
    }
    expectedVersion = resources.manifest.version;
    expectedSchema = reviewedOfficecliSchemaCrc(resources.manifest, `${process.platform}-${process.arch}`);
    classifyAndValidateCommand(argv, request.mode, resources.manifest.commandPolicy, request.allowLifecycle);
    argv = translateLogicalArgv(argv);
    argv = normalizeOfficeDocumentArgv(argv);
    argv = prepareInspectArtifactOutput(ctx, argv, request.mode, cwd);
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
    if (argv[0] === 'status') {
      const cachedStatus = sessionStatusCache.get(ctx.sessionId);
      if (cachedStatus) {
        return reusedStatusOutcome(
          cachedStatus,
          ctx.sessionId,
          cwd,
          Math.max(0, now() - startedAt),
          runtime.path,
        );
      }
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
      const envelope = attachSessionDocument({
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
          standardTask: OFFICE_STANDARD_TASK_HINT,
        },
        warnings: [],
        cacheHit: false,
        artifacts: [],
      }, ctx.sessionId, cwd);
      sessionStatusCache.set(ctx.sessionId, envelope);
      return {
        envelope,
        stdout: metadata.version,
        stderr: '',
        exitCode: 0,
        cwd,
        binary: runtime.path,
      };
    }

    // A new create/merge output has no prior artifact revision. Registering its
    // missing path here would make the first successful mutation revision 2.
    const revisionBefore = documentPath && existsSync(documentPath)
      ? getOfficeArtifactRevision(documentPath)
      : undefined;
    const normalizedArgv = argv.filter(token => !JSON_FLAGS.has(flagName(token)));
    const cliArgv = [...normalizedArgv, '--json'];
    const importRecipePolicy = resources.manifest.compatibilityRecipes?.importViaAtomicBatch;
    const importSource = argv[0] === 'import' && importRecipePolicy?.enabled
      ? loadReviewedImportSource(argv, ctx, cwd, importRecipePolicy.maxSourceBytes)
      : undefined;
    const fingerprint = cacheFingerprint(
      importSource
        ? [...normalizedArgv, `selection-import-source:${statKey(importSource.spec.sourcePath)}`]
        : normalizedArgv,
      cwd,
      revisionBefore,
    );
    const resultCacheKey = cacheKey(ctx.sessionId, documentPath, fingerprint);
    const shouldCache = request.cacheable ?? request.mode === 'inspect';
    const cached = shouldCache ? inspectCache.get(resultCacheKey) : undefined;
    if (cached) {
      return {
        envelope: {
          ...cached,
          cacheHit: true,
          durationMs: Math.max(0, now() - startedAt),
          warnings: argv[0] === 'help'
            ? [
                ...cached.warnings,
                {
                  code: 'help_already_provided',
                  message: 'This OfficeCLI help payload was already returned in this session.',
                  recovery: 'Reuse the previous help result. Call help again only for a different format or element.',
                  severity: 'low',
                },
              ]
            : cached.warnings,
        },
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

    let useResident = request.allowLifecycle && LIFECYCLE_COMMANDS.has(argv[0] ?? '');
    if (shouldAttachResidentLease(request, argv, documentPath) && documentPath) {
      useResident = await ensureResidentLeaseOpen(ctx, documentPath, runner, runtime.path, cwd, remaining);
    }
    const envMode: OfficeResidentMode = useResident && !request.skipResident ? 'resident' : 'standalone';
    if (isInspectArtifactCommand(argv) && documentPath && hasOpenOfficeResidentLease(documentPath)) {
      const flushed = await flushOfficeResidentLease(ctx, documentPath, dependencies);
      if (flushed && !flushed.envelope.ok) {
        return {
          envelope: { ...flushed.envelope, command: cliArgv },
          stdout: flushed.stdout,
          stderr: flushed.stderr,
          exitCode: flushed.exitCode,
          cwd,
          binary: runtime.path,
        };
      }
    }

    let executionArgv = cliArgv;
    let recipePath: string | undefined;
    let appliedImportRecipe: OfficeImportRecipe | undefined;
    const executionWarnings: StructuredWarning[] = [];
    if (argv[0] === 'import' && importRecipePolicy?.enabled && importSource) {
      const nativeImport = await runner(runtime.path, cliArgv, {
        cwd,
        env: buildOfficeEnvironment(undefined, envMode),
        timeoutMs: remaining,
      });
      const nativeParsed = parseJson(nativeImport.stdout);
      const nativeOk = (nativeImport.exitCode === 0 || nativeImport.exitCode === 2)
        && extractSuccess(nativeParsed) !== false
        && !nativeImport.timedOut;
      if (nativeOk) {
        const probePath = `${importSource.spec.parentPath}/${importSource.spec.startCell}`;
        const probe = await runner(runtime.path, ['get', argv[1]!, probePath, '--json'], {
          cwd,
          env: buildOfficeEnvironment(undefined, envMode),
          timeoutMs: Math.min(10_000, Math.max(1, remaining)),
        });
        const expected = firstImportedCellValue(importSource.rows);
        if (importContentPersisted(extractData(parseJson(probe.stdout)), expected)) {
          appliedImportRecipe = undefined;
          executionArgv = cliArgv;
          const nativeDuration = Math.max(0, now() - startedAt);
          const mutates = request.mutation ?? request.mode === 'edit';
          const revision = documentPath
            ? mutates
              ? markMutation(documentPath, ctx.sessionId)
              : getOfficeArtifactRevision(documentPath)
            : undefined;
          const artifact = documentPath ? documentArtifact(documentPath, revision) : undefined;
          const envelope: OfficeResultEnvelope = {
            ok: true,
            version: metadata.version,
            schemaCrc: metadata.schemaCrc,
            command: cliArgv,
            cwd,
            ...(documentPath ? { documentPath } : {}),
            durationMs: nativeDuration,
            data: extractData(nativeParsed),
            backend: 'officecli',
            warnings: extractWarnings(nativeParsed, nativeImport.stderr, nativeImport.truncated),
            cacheHit: false,
            ...(revision !== undefined ? { artifactRevision: revision } : {}),
            artifacts: artifact ? [artifact] : [],
            stdout: nativeImport.stdout,
            stderr: nativeImport.stderr,
            exitCode: nativeImport.exitCode,
          };
          if (shouldCache) inspectCache.set(resultCacheKey, envelope);
          if (documentPath && mutates) sessionDocumentPaths.set(ctx.sessionId, documentPath);
          return { envelope, ...nativeImport, cwd, binary: runtime.path };
        }
      }
      appliedImportRecipe = materializeReviewedImportRecipe(importSource, importRecipePolicy.maxSourceBytes);
      const sessionDataRoot = ctx.dataPath || (ctx.sessionPath ? join(ctx.sessionPath, 'data') : join(cwd, '.selection-data'));
      const recipeDirectory = join(sessionDataRoot, 'office', 'runtime');
      recipePath = join(recipeDirectory, `import-${randomUUID()}.json`);
      try {
        mkdirSync(recipeDirectory, { recursive: true });
        writeFileSync(recipePath, appliedImportRecipe.serialized, { encoding: 'utf8', mode: 0o600 });
      } catch (error) {
        throw structuredError(
          'import_recipe_unavailable',
          'runtime',
          `Selection could not stage the atomic OfficeCLI import recipe: ${error instanceof Error ? error.message : String(error)}`,
          { retriable: true },
        );
      }
      executionArgv = ['batch', argv[1]!, '--input', recipePath, '--json'];
      executionWarnings.push({
        code: 'reviewed_import_recipe_applied',
        message: nativeOk
          ? `OfficeCLI ${metadata.version} native import reported success but did not persist cells; Selection used one atomic OfficeCLI batch recipe instead.`
          : `OfficeCLI ${metadata.version} native import failed; Selection used one atomic OfficeCLI batch recipe instead.`,
        severity: 'medium',
        recovery: 'Remove this compatibility recipe only after a reviewed OfficeCLI upgrade passes the real import content assertion.',
      });
    }
    let result: OfficecliProcessResult;
    try {
      result = await runner(runtime.path, executionArgv, {
        cwd,
        env: buildOfficeEnvironment(undefined, envMode),
        timeoutMs: remaining,
      });
    } finally {
      if (recipePath) {
        try {
          rmSync(recipePath, { force: true });
        } catch (error) {
          executionWarnings.push({
            code: 'import_recipe_cleanup_failed',
            message: `Selection could not remove temporary import recipe ${recipePath}: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'medium',
          });
        }
      }
    }
    const durationMs = Math.max(0, now() - startedAt);
    const mutates = request.mutation ?? request.mode === 'edit';
    if (result.timedOut) {
      const timeoutError = structuredError('timeout', 'timeout', `OfficeCLI exceeded the ${timeoutMs}ms timeout.`, {
        retriable: true,
        recovery: 'Use a narrower operation or increase timeoutMs.',
      });
      if (
        !request.skipResident
        && !request.allowLifecycle
        && documentPath
        && shouldRetryWithoutResident(result, timeoutError, mutates)
      ) {
        await evictResidentLeaseForRetry(ctx, documentPath, runner, runtime.path, cwd);
        return executeOfficeCommand(ctx, { ...request, skipResident: true }, dependencies);
      }
      const envelope = errorEnvelope(
        metadata.version,
        metadata.schemaCrc,
        executionArgv,
        cwd,
        timeoutError,
        durationMs,
        documentPath,
      );
      return { envelope, ...result, cwd, binary: runtime.path };
    }
    const parsed = parseJson(result.stdout);
    const upstreamSuccess = extractSuccess(parsed);
    const appliedWithCaveats = result.exitCode === 2 && upstreamSuccess !== false && result.stdout.trim().length > 0;
    const ok = (result.exitCode === 0 || appliedWithCaveats) && upstreamSuccess !== false;
    const warnings = [...extractWarnings(parsed, result.stderr, result.truncated), ...executionWarnings];
    if (appliedWithCaveats) {
      warnings.push({
        code: 'applied_with_caveats',
        message: 'OfficeCLI applied the operation but reported unsupported properties or other caveats.',
        severity: 'high',
      });
    }
    if (!ok) {
      const error = upstreamError(parsed, result.stderr.trim() || result.stdout.trim());
      if (
        !request.skipResident
        && !request.allowLifecycle
        && documentPath
        && shouldRetryWithoutResident(result, error, mutates)
      ) {
        await evictResidentLeaseForRetry(ctx, documentPath, runner, runtime.path, cwd);
        return executeOfficeCommand(ctx, { ...request, skipResident: true }, dependencies);
      }
      if (error.category !== 'timeout' && error.category !== 'dependency') {
        const key = failureKey(ctx.sessionId, documentPath);
        const previous = failureStates.get(key);
        failureStates.set(key, {
          fingerprint,
          count: previous?.fingerprint === fingerprint ? previous.count + 1 : 1,
        });
      }
      const envelope: OfficeResultEnvelope = {
        ...errorEnvelope(metadata.version, metadata.schemaCrc, executionArgv, cwd, error, durationMs, documentPath),
        warnings,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
      return { envelope, ...result, cwd, binary: runtime.path };
    }
    failureStates.delete(failureKey(ctx.sessionId, documentPath));
    if (request.skipResident && documentPath && existsSync(documentPath) && !SKIP_RESIDENT_COMMANDS.has(argv[0] ?? '')) {
      await ensureResidentLeaseOpen(ctx, documentPath, runner, runtime.path, cwd, 10_000);
    }
    const revision = documentPath
      ? mutates
        ? markMutation(documentPath, ctx.sessionId)
        : argv[0] === 'save'
          ? syncOfficeArtifactStat(documentPath)
          : getOfficeArtifactRevision(documentPath)
      : undefined;
    const artifact = documentPath ? documentArtifact(documentPath, revision) : undefined;
    const inspectOut = inspectOutputPath(argv, cwd);
    const inspectArtifact = inspectOut ? inspectArtifactRef(inspectOut) : undefined;
    const upstreamData = extractData(parsed);
    const data = appliedImportRecipe
      ? {
          import: {
            sourcePath: appliedImportRecipe.sourcePath,
            parentPath: appliedImportRecipe.parentPath,
            format: appliedImportRecipe.format,
            header: appliedImportRecipe.header,
            startCell: appliedImportRecipe.startCell,
            rows: appliedImportRecipe.rows,
            columns: appliedImportRecipe.columns,
          },
          batch: upstreamData,
          requestedCommand: cliArgv,
        }
      : upstreamData;
    const backend = appliedImportRecipe ? 'officecli-batch-recipe' : extractBackend(parsed);
    const artifacts = [artifact, inspectArtifact].filter((item): item is ArtifactRef => Boolean(item));
    const envelope: OfficeResultEnvelope = {
      ok: true,
      version: metadata.version,
      schemaCrc: metadata.schemaCrc,
      command: executionArgv,
      cwd,
      ...(documentPath ? { documentPath } : {}),
      durationMs,
      data,
      ...(backend ? { backend } : {}),
      warnings,
      cacheHit: false,
      ...(revision !== undefined ? { artifactRevision: revision } : {}),
      artifacts,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
    if (shouldCache) inspectCache.set(resultCacheKey, envelope);
    if (documentPath && mutates) sessionDocumentPaths.set(ctx.sessionId, documentPath);
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
  sessionStatusCache.clear();
  sessionDocumentPaths.clear();
  clearOfficeResidentLeases();
}

export function releaseOfficeRuntimeSession(sessionId: string): Promise<void> {
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
  sessionStatusCache.delete(sessionId);
  sessionDocumentPaths.delete(sessionId);
  return Promise.all(detachOfficeResidentSession(sessionId).map(closeOfficeResidentLease)).then(() => undefined);
}
