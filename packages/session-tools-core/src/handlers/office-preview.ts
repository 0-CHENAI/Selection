import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import sharp from 'sharp';
import type { SessionToolContext } from '../context.ts';
import type { ArtifactRef, OfficeResultEnvelope, StructuredWarning } from '../office-types.ts';
import type { ToolResult } from '../types.ts';
import {
  buildOfficeEnvironment,
  chooseOfficeWorkingDirectory,
  executeOfficeCommand,
  flushOfficeResidentLease,
  getOfficeArtifactRevision,
  officeSessionArtifactDirectory,
  officeToolResult,
  type OfficeCoordinatorDependencies,
} from '../runtime/office-coordinator.ts';
import { resolveOfficecliResources } from '../runtime/office-manifest.ts';
import { isPathWithinDirectory, isPathWithinDirectoryForCreation } from '../runtime/path-security.ts';

export type OfficeDocumentPreviewArgs =
  | {
      action: 'render';
      file: string;
      page?: string;
      range?: string;
      grid?: number | 'auto';
      renderer?: 'auto' | 'html' | 'native';
      timeoutMs?: number;
    }
  | { action: 'start'; file: string }
  | { action: 'status'; file: string }
  | { action: 'stop'; file: string }
  | { action: 'goto'; file: string; path: string }
  | { action: 'selection'; file: string }
  | { action: 'mark'; file: string; path: string; props?: Record<string, string | number | boolean> }
  | { action: 'unmark'; file: string; path?: string; all?: boolean }
  | { action: 'get_marks'; file: string };

interface WatchRecord {
  file: string;
  url: string;
  owned: boolean;
  child?: ChildProcessWithoutNullStreams;
  sessions: Set<string>;
  startedAt: number;
}

interface StartedWatch {
  url: string;
  owned: boolean;
  child?: ChildProcessWithoutNullStreams;
}

interface RenderedPreview {
  toolResult: ToolResult;
  envelope: OfficeResultEnvelope;
  fullImagePath?: string;
  previewImagePath?: string;
}

const watches = new Map<string, WatchRecord>();
const watchStartPromises = new Map<string, Promise<WatchRecord>>();
const sessionWatchStartPromises = new Map<string, Promise<ToolResult>>();
const watchStartWaiterCounts = new Map<string, number>();
const pendingWatchChildren = new Map<string, ChildProcessWithoutNullStreams>();
const previewSessionEpochs = new Map<string, number>();
let previewStateGeneration = 0;
const WATCH_START_TIMEOUT_MS = 20_000;
const MAX_INLINE_IMAGE_BYTES = Math.floor(4.5 * 1024 * 1024);
const MAX_HTML_DEPENDENCY_PROBE_BYTES = 20 * 1024 * 1024;
const INLINE_IMAGE_LONG_EDGE = 1600;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const PREVIEW_ACTIONS = new Set([
  'render', 'start', 'status', 'stop', 'goto', 'selection', 'mark', 'unmark', 'get_marks',
]);

export type OfficeRenderDependencyState =
  | 'not-required'
  | 'self-contained'
  | 'runtime-network-assets'
  | 'degraded'
  | 'unknown';

export function detectOfficeHtmlDependencies(html: string): string[] {
  const dependencies: string[] = [];
  if (/katex(?:[.@/-]|\.min)/i.test(html)) dependencies.push('katex');
  if (/(?:three(?:[.@/-]|\.module)|GLTFLoader)/i.test(html)) dependencies.push('three');
  if (/(?:@mermaid-js\/layout-elk|mermaid-layout-elk)/i.test(html)) dependencies.push('mermaid-layout-elk');
  if (/mermaid(?:[.@/-]|\.min)/i.test(html)) dependencies.push('mermaid');
  return [...new Set(dependencies)].sort();
}

export function officeRenderingIsOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SELECTION_OFFLINE === '1' || env.CRAFT_OFFLINE === '1' || env.OFFICECLI_OFFLINE === '1';
}

function manifestMetadata(): { version: string; schemaCrc: string } {
  const resources = resolveOfficecliResources();
  return {
    version: resources?.manifest.version ?? 'unknown',
    schemaCrc: resources?.manifest.schemaCrc ?? 'unknown',
  };
}

function previewError(
  ctx: SessionToolContext,
  command: string[],
  code: string,
  category: 'input' | 'path' | 'permission' | 'runtime' | 'dependency' | 'timeout' | 'conflict' | 'unsupported',
  message: string,
  recovery?: string,
  documentPath?: string,
): ToolResult {
  const metadata = manifestMetadata();
  let cwd = ctx.workspacePath;
  try { cwd = chooseOfficeWorkingDirectory(ctx); } catch { /* keep deterministic fallback for the error */ }
  return officeToolResult({
    ok: false,
    version: metadata.version,
    schemaCrc: metadata.schemaCrc,
    command,
    cwd,
    ...(documentPath ? { documentPath } : {}),
    durationMs: 0,
    warnings: [],
    cacheHit: false,
    artifacts: [],
    error: { code, category, message, retriable: category === 'timeout' || category === 'runtime', ...(recovery ? { recovery } : {}) },
  });
}

function normalizedFile(file: string, cwd: string): string {
  const resolved = resolve(isAbsolute(file) ? file : join(cwd, file));
  return existsSync(resolved) ? realpathSync.native(resolved) : resolved;
}

function isAuthorizedPreviewPath(ctx: SessionToolContext, cwd: string, file: string): boolean {
  const roots = [cwd, ctx.sessionPath, ctx.workspacePath]
    .filter((value): value is string => Boolean(value && existsSync(value)))
    .map(root => realpathSync.native(resolve(root)));
  return roots.some(root => (
    isPathWithinDirectory(file, root) || isPathWithinDirectoryForCreation(file, root)
  ));
}

function assertLoopbackUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || !url.port) {
    throw new Error(`OfficeCLI returned a non-loopback preview URL: ${raw}`);
  }
  return url.toString();
}

async function externalWatchAlive(record: WatchRecord): Promise<boolean> {
  if (record.owned) return Boolean(record.child && record.child.exitCode === null && !record.child.killed);
  try {
    const response = await fetch(record.url, { signal: AbortSignal.timeout(1500) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

function parseWatchUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/i);
  return match?.[0];
}

async function spawnWatch(
  binary: string,
  file: string,
  cwd: string,
  onSpawn: (child: ChildProcessWithoutNullStreams) => void,
): Promise<StartedWatch> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, ['watch', file, '--port', '0'], {
      cwd,
      env: buildOfficeEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    onSpawn(child);
    child.stdin.end();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value: StartedWatch) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill('SIGKILL');
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error(`OfficeCLI watch did not publish a loopback URL within ${WATCH_START_TIMEOUT_MS}ms.`));
    }, WATCH_START_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-20_000);
      const rawUrl = parseWatchUrl(stdout);
      if (rawUrl && /Watch:/i.test(stdout)) {
        try { finish({ url: assertLoopbackUrl(rawUrl), owned: true, child }); }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-20_000);
      const rawUrl = parseWatchUrl(stderr);
      if (rawUrl && /another watch process/i.test(stderr)) {
        try {
          finish({ url: assertLoopbackUrl(rawUrl), owned: false });
          // This is only the probe process Selection just spawned; the
          // already-running external watch is a different process and must be
          // preserved. Do not leave the probe orphaned after reusing its URL.
          if (child.exitCode === null) child.kill('SIGTERM');
        }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    child.on('error', error => fail(error));
    child.on('close', exitCode => {
      if (!settled) {
        fail(new Error(stderr.trim() || stdout.trim() || `OfficeCLI watch exited with code ${exitCode}.`));
      }
    });
  });
}

function attachWatchLifecycle(record: WatchRecord): void {
  if (!record.child) return;
  record.child.on('close', () => {
    if (watches.get(record.file)?.child === record.child) watches.delete(record.file);
  });
}

async function createWatchRecord(binary: string, file: string, cwd: string): Promise<WatchRecord> {
  const generation = previewStateGeneration;
  let pendingChild: ChildProcessWithoutNullStreams | undefined;
  const pending = (async () => {
    const started = await spawnWatch(binary, file, cwd, child => {
      pendingChild = child;
      pendingWatchChildren.set(file, child);
    });
    if (generation !== previewStateGeneration) {
      if (started.child?.exitCode === null) started.child.kill('SIGKILL');
      throw new Error('Office preview state was cleared while the watch was starting.');
    }
    const record: WatchRecord = {
      file,
      url: started.url,
      owned: started.owned,
      child: started.child,
      sessions: new Set(),
      startedAt: Date.now(),
    };
    watches.set(file, record);
    attachWatchLifecycle(record);
    return record;
  })();
  watchStartPromises.set(file, pending);
  try {
    return await pending;
  } finally {
    if (watchStartPromises.get(file) === pending) watchStartPromises.delete(file);
    if (pendingChild && pendingWatchChildren.get(file) === pendingChild) pendingWatchChildren.delete(file);
  }
}

function stopOwnedWatch(record: WatchRecord, force = false): void {
  if (!record.owned || !record.child || record.child.exitCode !== null) return;
  if (force) {
    record.child.kill('SIGKILL');
    return;
  }
  record.child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (record.child?.exitCode === null) record.child.kill('SIGKILL');
  }, 2_000);
  timer.unref?.();
}

async function validatedDocument(
  ctx: SessionToolContext,
  file: string,
  dependencies: OfficeCoordinatorDependencies,
): Promise<Awaited<ReturnType<typeof executeOfficeCommand>>> {
  return executeOfficeCommand(ctx, {
    argv: ['get', file, '/', '--depth', '0'],
    mode: 'preview',
    mutation: false,
    cacheable: true,
  }, dependencies);
}

function officeArtifactDirectory(ctx: SessionToolContext, cwd: string): string {
  return officeSessionArtifactDirectory(ctx, cwd);
}

async function createInlinePreview(
  fullImagePath: string,
  directory: string,
  id: string,
): Promise<{ buffer: Buffer; path: string; mimeType: string; width?: number; height?: number; warning?: StructuredWarning }> {
  const image = sharp(fullImagePath).rotate();
  const metadata = await image.metadata();
  let buffer = await image
    .resize({ width: INLINE_IMAGE_LONG_EDGE, height: INLINE_IMAGE_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  let mimeType = 'image/png';
  let path = join(directory, `preview-${id}.png`);
  let warning: StructuredWarning | undefined;
  if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
    buffer = await sharp(buffer).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    mimeType = 'image/jpeg';
    path = join(directory, `preview-${id}.jpg`);
    warning = {
      code: 'preview_reencoded',
      message: 'The inline preview exceeded the image budget and was re-encoded as JPEG; the full PNG artifact is preserved.',
      severity: 'low',
    };
  }
  if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
    buffer = await sharp(buffer)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
    mimeType = 'image/jpeg';
    path = join(directory, `preview-${id}.jpg`);
  }
  writeFileSync(path, buffer);
  const previewMetadata = await sharp(buffer).metadata();
  return {
    buffer,
    path,
    mimeType,
    width: previewMetadata.width ?? metadata.width,
    height: previewMetadata.height ?? metadata.height,
    warning,
  };
}

function imageArtifact(
  path: string,
  revision: number | undefined,
  mimeType: string,
  width?: number,
  height?: number,
  page?: string,
): ArtifactRef {
  return {
    kind: 'image',
    path,
    mimeType,
    sizeBytes: statSync(path).size,
    width,
    height,
    page,
    artifactRevision: revision,
  };
}

function renderToolResult(envelope: OfficeResultEnvelope, previewPath: string, buffer: Buffer, mimeType: string): ToolResult {
  const text = [
    JSON.stringify(envelope, null, 2),
    '',
    '```image-preview',
    JSON.stringify({ src: previewPath, title: `Office preview: ${basename(envelope.documentPath ?? previewPath)}` }, null, 2),
    '```',
  ].join('\n');
  return {
    content: [
      { type: 'text', text },
      { type: 'image', data: buffer.toString('base64'), mimeType },
    ],
    structuredContent: envelope,
    isError: !envelope.ok,
  };
}

async function executeRenderAttempt(
  ctx: SessionToolContext,
  args: Extract<OfficeDocumentPreviewArgs, { action: 'render' }>,
  renderer: 'html' | 'native',
  outputPath: string,
  dependencies: OfficeCoordinatorDependencies,
): Promise<Awaited<ReturnType<typeof executeOfficeCommand>>> {
  const argv = ['view', args.file, 'screenshot'];
  if (args.page) argv.push('--page', args.page);
  if (args.range) argv.push('--range', args.range);
  if (args.grid !== undefined) argv.push('--grid', String(args.grid));
  argv.push('--render', renderer, '--out', outputPath);
  return executeOfficeCommand(ctx, {
    argv,
    mode: 'internal',
    timeoutMs: args.timeoutMs,
    mutation: false,
    cacheable: false,
  }, dependencies);
}

interface HtmlDependencyProbe {
  state: OfficeRenderDependencyState;
  dependencies: string[];
  artifact?: ArtifactRef;
  warning?: StructuredWarning;
}

async function probeHtmlDependencies(
  ctx: SessionToolContext,
  args: Extract<OfficeDocumentPreviewArgs, { action: 'render' }>,
  directory: string,
  safeStem: string,
  id: string,
  dependencies: OfficeCoordinatorDependencies,
): Promise<HtmlDependencyProbe> {
  const htmlPath = join(directory, `${safeStem}-${id}.html`);
  const argv = ['view', args.file, 'html'];
  if (args.page) argv.push('--page', args.page);
  argv.push('--out', htmlPath);
  const outcome = await executeOfficeCommand(ctx, {
    argv,
    mode: 'internal',
    timeoutMs: args.timeoutMs,
    mutation: false,
    cacheable: false,
  }, dependencies);
  if (!outcome.envelope.ok || !existsSync(htmlPath)) {
    return {
      state: 'unknown',
      dependencies: [],
      warning: {
        code: 'render_dependency_probe_unavailable',
        message: 'Selection could not inspect the generated HTML for runtime network dependencies.',
        severity: 'low',
        recovery: 'Use native rendering or rerun the preview after resolving the HTML renderer error.',
      },
    };
  }
  const htmlSize = statSync(htmlPath).size;
  const revision = getOfficeArtifactRevision(outcome.envelope.documentPath);
  const artifact: ArtifactRef = {
    kind: 'html',
    path: htmlPath,
    mimeType: 'text/html',
    sizeBytes: htmlSize,
    artifactRevision: revision,
  };
  if (htmlSize > MAX_HTML_DEPENDENCY_PROBE_BYTES) {
    return {
      state: 'unknown',
      dependencies: [],
      artifact,
      warning: {
        code: 'render_dependency_probe_too_large',
        message: `The generated HTML exceeds the ${MAX_HTML_DEPENDENCY_PROBE_BYTES}-byte dependency scan limit.`,
        severity: 'medium',
        recovery: 'Use native rendering or inspect the saved HTML artifact before strict delivery.',
      },
    };
  }
  const externalDependencies = detectOfficeHtmlDependencies(readFileSync(htmlPath, 'utf8'));
  if (externalDependencies.length === 0) {
    return { state: 'self-contained', dependencies: externalDependencies, artifact };
  }
  if (officeRenderingIsOffline()) {
    return {
      state: 'degraded',
      dependencies: externalDependencies,
      artifact,
      warning: {
        code: 'offline_render_degraded',
        message: `The HTML renderer references ${externalDependencies.join(', ')} network assets while Selection is in offline mode; fallback output may omit high-fidelity equations, diagrams, or 3D layers.`,
        severity: 'high',
        recovery: 'Use a reviewed online render, use the native renderer where available, or remove the network-dependent content.',
      },
    };
  }
  return {
    state: 'runtime-network-assets',
    dependencies: externalDependencies,
    artifact,
    warning: {
      code: 'render_uses_external_dependencies',
      message: `The HTML renderer references reviewed runtime assets: ${externalDependencies.join(', ')}.`,
      severity: 'low',
      recovery: 'For offline delivery, verify a native render or accept the documented fallback behavior before finalization.',
    },
  };
}

export async function renderOfficeDocument(
  ctx: SessionToolContext,
  args: Extract<OfficeDocumentPreviewArgs, { action: 'render' }>,
  dependencies: OfficeCoordinatorDependencies = {},
): Promise<RenderedPreview> {
  const startedAt = Date.now();
  if (!args || typeof args.file !== 'string' || !args.file.trim()) {
    const result = previewError(ctx, ['preview', 'render'], 'invalid_preview_input', 'input', 'Render requires a non-empty Office document path.');
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  if (args.page !== undefined && (typeof args.page !== 'string' || !args.page.trim())) {
    const result = previewError(ctx, ['preview', 'render', args.file], 'invalid_page_selector', 'input', 'page must be a non-empty page/slide selector.');
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  if (args.range !== undefined && (typeof args.range !== 'string' || !args.range.trim())) {
    const result = previewError(ctx, ['preview', 'render', args.file], 'invalid_range_selector', 'input', 'range must be a non-empty element path or Excel range.');
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  if (args.grid !== undefined && args.grid !== 'auto' && (!Number.isInteger(args.grid) || args.grid <= 0)) {
    const result = previewError(ctx, ['preview', 'render', args.file], 'invalid_grid', 'input', 'grid must be "auto" or a positive integer column count.');
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  if (args.grid !== undefined && (args.page !== undefined || args.range !== undefined)) {
    const result = previewError(
      ctx,
      ['preview', 'render', args.file],
      'render_selector_conflict',
      'input',
      'grid creates a whole-document contact sheet and cannot be combined with page or range.',
      'Use grid alone for a contact sheet, or omit grid for a focused page/range render.',
    );
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  if (args.renderer !== undefined && !['auto', 'html', 'native'].includes(args.renderer)) {
    const result = previewError(ctx, ['preview', 'render', args.file], 'invalid_renderer', 'input', 'renderer must be auto, html, or native.');
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  const extension = extname(args.file).toLowerCase();
  if (args.grid !== undefined && extension === '.xlsx') {
    const result = previewError(
      ctx,
      ['preview', 'render', args.file],
      'xlsx_contact_sheet_unsupported',
      'unsupported',
      'OfficeCLI contact-sheet rendering is available for Word and PowerPoint, not Excel workbooks.',
      'Render a focused Excel sheet or cell range without grid.',
    );
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  let cwd: string;
  try {
    cwd = chooseOfficeWorkingDirectory(ctx);
  } catch (error) {
    const result = previewError(ctx, ['preview', 'render'], 'working_directory_unavailable', 'path', error instanceof Error ? error.message : String(error));
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  const directory = officeArtifactDirectory(ctx, cwd);
  await flushOfficeResidentLease(ctx, args.file, dependencies);
  const id = randomUUID();
  const safeStem = basename(args.file, extname(args.file)).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'document';
  const fullImagePath = join(directory, `${safeStem}-${id}.png`);
  const requested = args.renderer ?? 'auto';
  let backend: 'html' | 'native' = requested === 'native' ? 'native' : 'html';
  let outcome;
  const fallbacks: StructuredWarning[] = [];
  if (requested === 'auto' && extension !== '.xlsx') {
    outcome = await executeRenderAttempt(ctx, args, 'native', fullImagePath, dependencies);
    if (outcome.envelope.ok) {
      backend = 'native';
    } else {
      fallbacks.push({
        code: 'native_renderer_unavailable',
        message: outcome.envelope.error?.message ?? 'Native renderer was unavailable; Selection used OfficeCLI HTML rendering.',
        severity: 'low',
      });
      outcome = await executeRenderAttempt(ctx, args, 'html', fullImagePath, dependencies);
      backend = 'html';
    }
  } else {
    if (requested === 'native' && extension === '.xlsx') {
      const result = previewError(
        ctx,
        ['preview', 'render', args.file],
        'native_xlsx_preview_unsupported',
        'unsupported',
        'OfficeCLI 1.0.144 does not expose a distinct native Excel screenshot backend.',
        'Use renderer=html or renderer=auto.',
      );
      return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
    }
    backend = requested === 'native' ? 'native' : 'html';
    outcome = await executeRenderAttempt(ctx, args, backend, fullImagePath, dependencies);
  }
  const dependencyProbe = outcome.envelope.ok && backend === 'html'
    ? await probeHtmlDependencies(ctx, args, directory, safeStem, id, dependencies)
    : { state: 'not-required' as const, dependencies: [] };
  const actualBackend = outcome.envelope.backend ?? backend;
  if (!outcome.envelope.ok) {
    const envelope: OfficeResultEnvelope = {
      ...outcome.envelope,
      command: ['preview', 'render', ...outcome.envelope.command],
      backend: actualBackend,
      data: {
        render: {
          backend: actualBackend,
          dependencyState: dependencyProbe.state,
          externalDependencies: dependencyProbe.dependencies,
        },
      },
      warnings: [...outcome.envelope.warnings, ...fallbacks],
    };
    return { toolResult: officeToolResult(envelope), envelope };
  }
  if (!existsSync(fullImagePath) || !statSync(fullImagePath).isFile()) {
    const result = previewError(
      ctx,
      ['preview', 'render', args.file],
      'render_artifact_missing',
      'runtime',
      `OfficeCLI reported success but produced no screenshot at ${fullImagePath}.`,
      undefined,
      outcome.envelope.documentPath,
    );
    return { toolResult: result, envelope: result.structuredContent as OfficeResultEnvelope };
  }
  try {
    const inline = await createInlinePreview(fullImagePath, directory, id);
    const revision = getOfficeArtifactRevision(outcome.envelope.documentPath);
    const fullMetadata = await sharp(fullImagePath).metadata();
    const fullArtifact = imageArtifact(
      fullImagePath,
      revision,
      'image/png',
      fullMetadata.width,
      fullMetadata.height,
      args.page ?? (args.grid !== undefined ? `grid:${args.grid}` : '1'),
    );
    const previewArtifact = imageArtifact(
      inline.path,
      revision,
      inline.mimeType,
      inline.width,
      inline.height,
      args.page,
    );
    const envelope: OfficeResultEnvelope = {
      ...outcome.envelope,
      command: ['preview', 'render', ...outcome.envelope.command],
      durationMs: Math.max(0, Date.now() - startedAt),
      backend: actualBackend,
      warnings: [
        ...outcome.envelope.warnings,
        ...fallbacks,
        ...(dependencyProbe.warning ? [dependencyProbe.warning] : []),
        ...(inline.warning ? [inline.warning] : []),
      ],
      artifacts: [
        ...outcome.envelope.artifacts,
        ...(dependencyProbe.artifact ? [dependencyProbe.artifact] : []),
        fullArtifact,
        previewArtifact,
      ],
      data: {
        render: {
          backend: actualBackend,
          dependencyState: dependencyProbe.state,
          externalDependencies: dependencyProbe.dependencies,
          page: args.page,
          range: args.range,
          grid: args.grid,
          fullImagePath,
          previewImagePath: inline.path,
        },
      },
    };
    return {
      toolResult: renderToolResult(envelope, inline.path, inline.buffer, inline.mimeType),
      envelope,
      fullImagePath,
      previewImagePath: inline.path,
    };
  } catch (error) {
    const result = previewError(
      ctx,
      ['preview', 'render', args.file],
      'image_processing_failed',
      'dependency',
      `The full screenshot was saved, but the bounded inline preview failed: ${error instanceof Error ? error.message : String(error)}`,
      'Open the full PNG artifact or reinstall Selection with Sharp runtime assets.',
      outcome.envelope.documentPath,
    );
    const envelope = result.structuredContent as OfficeResultEnvelope;
    envelope.artifacts.push(imageArtifact(fullImagePath, outcome.envelope.artifactRevision, 'image/png'));
    return { toolResult: officeToolResult(envelope), envelope, fullImagePath };
  }
}

async function interactiveEnvelope(
  ctx: SessionToolContext,
  action: string,
  file: string,
  data: Record<string, unknown>,
  base?: OfficeResultEnvelope,
): Promise<ToolResult> {
  const metadata = manifestMetadata();
  const cwd = chooseOfficeWorkingDirectory(ctx);
  const documentPath = normalizedFile(file, cwd);
  const envelope: OfficeResultEnvelope = {
    ok: true,
    version: base?.version ?? metadata.version,
    schemaCrc: base?.schemaCrc ?? metadata.schemaCrc,
    command: ['preview', action, file],
    cwd,
    documentPath,
    durationMs: base?.durationMs ?? 0,
    data,
    backend: 'officecli-watch',
    warnings: base?.warnings ?? [],
    cacheHit: false,
    ...(existsSync(documentPath) ? { artifactRevision: getOfficeArtifactRevision(documentPath) } : {}),
    artifacts: base?.artifacts ?? [],
  };
  return officeToolResult(envelope);
}

export async function handleOfficeDocumentPreview(
  ctx: SessionToolContext,
  args: OfficeDocumentPreviewArgs,
  dependencies: OfficeCoordinatorDependencies = {},
): Promise<ToolResult> {
  if (!args || typeof args !== 'object' || typeof args.action !== 'string' || typeof args.file !== 'string' || !args.file.trim()) {
    return previewError(ctx, ['preview'], 'invalid_preview_input', 'input', 'Preview requires an action and non-empty file path.');
  }
  if (!PREVIEW_ACTIONS.has(args.action)) {
    return previewError(
      ctx,
      ['preview', args.action, args.file],
      'unknown_preview_action',
      'input',
      `Unknown preview action: ${args.action}`,
      'Use render, start, status, stop, goto, selection, mark, unmark, or get_marks.',
    );
  }
  if (args.action === 'render') return (await renderOfficeDocument(ctx, args, dependencies)).toolResult;
  let cwd: string;
  try {
    cwd = chooseOfficeWorkingDirectory(ctx);
  } catch (error) {
    return previewError(ctx, ['preview', args.action], 'working_directory_unavailable', 'path', error instanceof Error ? error.message : String(error));
  }
  const file = normalizedFile(args.file, cwd);
  if (!isAuthorizedPreviewPath(ctx, cwd, file)) {
    return previewError(
      ctx,
      ['preview', args.action, args.file],
      'path_outside_allowed_roots',
      'permission',
      `Preview path is outside the session working directory, session data, and workspace: ${file}`,
      'Move the file into an authorized folder or change the session working directory.',
      file,
    );
  }
  if (args.action === 'status') {
    const record = watches.get(file);
    const alive = record ? await externalWatchAlive(record) : false;
    if (record && !alive) watches.delete(file);
    const currentSessionReferenced = Boolean(record?.sessions.has(ctx.sessionId));
    return interactiveEnvelope(ctx, 'status', args.file, alive && record ? {
      running: true,
      ...(currentSessionReferenced ? { url: record.url } : {}),
      ownedBySelection: record.owned,
      sessionReferences: record.sessions.size,
      currentSessionReferenced,
      startedAt: new Date(record.startedAt).toISOString(),
    } : { running: false });
  }
  if (args.action === 'stop') {
    const record = watches.get(file);
    if (!record) return interactiveEnvelope(ctx, 'stop', args.file, { stopped: false, reason: 'not_running' });
    if (!record.sessions.has(ctx.sessionId)) {
      return interactiveEnvelope(ctx, 'stop', args.file, {
        stopped: false,
        reason: 'not_referenced_by_session',
        remainingSessionReferences: record.sessions.size,
      });
    }
    record.sessions.delete(ctx.sessionId);
    let stopped = false;
    if (record.sessions.size === 0) {
      watches.delete(file);
      if (record.owned) {
        stopOwnedWatch(record);
        stopped = true;
      }
    }
    return interactiveEnvelope(ctx, 'stop', args.file, {
      stopped,
      ownedBySelection: record.owned,
      externalWatchPreserved: !record.owned,
      remainingSessionReferences: record.sessions.size,
    });
  }
  if (!ctx.openOfficePreview) {
    return previewError(
      ctx,
      ['preview', args.action, args.file],
      'interactive_preview_unavailable',
      'unsupported',
      'Interactive Office preview requires the Selection desktop BrowserPane. Headless/server supports preview.render only.',
      'Use action=render for inline visual evidence.',
      file,
    );
  }
  const openOfficePreview = ctx.openOfficePreview;
  if (args.action === 'start') {
    const sessionStartKey = `${ctx.sessionId}\0${file}`;
    const activeSessionStart = sessionWatchStartPromises.get(sessionStartKey);
    if (activeSessionStart) return activeSessionStart;

    const sessionStart = (async (): Promise<ToolResult> => {
      const sessionEpoch = previewSessionEpochs.get(ctx.sessionId) ?? 0;
      const stateGeneration = previewStateGeneration;
      const validation = await validatedDocument(ctx, args.file, dependencies);
      if (!validation.envelope.ok || !validation.binary || !validation.envelope.documentPath) {
        return officeToolResult(validation.envelope);
      }
      const canonical = validation.envelope.documentPath;
      await flushOfficeResidentLease(ctx, canonical, dependencies);
      const invalidatedStart = (phase: string): ToolResult | undefined => {
        if (previewStateGeneration !== stateGeneration) {
          return previewError(
            ctx,
            ['preview', 'start', args.file],
            'preview_state_cleared',
            'conflict',
            `Selection cleared Office preview state while ${phase}.`,
            'Start the preview again after the application is ready.',
            canonical,
          );
        }
        if ((previewSessionEpochs.get(ctx.sessionId) ?? 0) !== sessionEpoch) {
          return previewError(
            ctx,
            ['preview', 'start', args.file],
            'preview_session_released',
            'conflict',
            `The session ended while ${phase}, so Selection discarded the pending watch reference.`,
            'Start the preview again from an active session.',
            canonical,
          );
        }
        return undefined;
      };
      const invalidAfterValidation = invalidatedStart('validating the Office document');
      if (invalidAfterValidation) return invalidAfterValidation;
      watchStartWaiterCounts.set(canonical, (watchStartWaiterCounts.get(canonical) ?? 0) + 1);
      let record: WatchRecord | undefined;
      try {
        record = watches.get(canonical);
        let reused = Boolean(record);
        if (record && !(await externalWatchAlive(record))) {
          watches.delete(canonical);
          record = undefined;
          reused = false;
        }
        if (!record) {
          try {
            const pending = watchStartPromises.get(canonical);
            reused = Boolean(pending);
            record = pending
              ? await pending
              : await createWatchRecord(validation.binary, canonical, validation.cwd);
            reused ||= !record.owned;
          } catch (error) {
            return previewError(
              ctx,
              ['preview', 'start', args.file],
              'watch_start_failed',
              'runtime',
              error instanceof Error ? error.message : String(error),
              'Use preview.render if a live watch is not required.',
              canonical,
            );
          }
        }
        const invalidAfterWatch = invalidatedStart('the OfficeCLI watch was starting');
        if (invalidAfterWatch) return invalidAfterWatch;
        const alreadyReferenced = record.sessions.has(ctx.sessionId);
        record.sessions.add(ctx.sessionId);
        try {
          const opened = await openOfficePreview(assertLoopbackUrl(record.url));
          const invalidAfterOpen = invalidatedStart('Selection was opening the Office preview');
          if (invalidAfterOpen) {
            record.sessions.delete(ctx.sessionId);
            return invalidAfterOpen;
          }
          return interactiveEnvelope(ctx, 'start', args.file, {
            running: true,
            reused: reused || alreadyReferenced,
            ownedBySelection: record.owned,
            url: record.url,
            browser: opened,
            sessionReferences: record.sessions.size,
          }, validation.envelope);
        } catch (error) {
          if (!alreadyReferenced) record.sessions.delete(ctx.sessionId);
          const invalidAfterFailure = invalidatedStart('Selection was opening the Office preview');
          if (invalidAfterFailure) return invalidAfterFailure;
          return previewError(
            ctx,
            ['preview', 'start', args.file],
            'browser_pane_open_failed',
            'runtime',
            `Watch started but BrowserPane could not open it: ${error instanceof Error ? error.message : String(error)}`,
            undefined,
            canonical,
          );
        }
      } finally {
        const activeWaiters = watchStartWaiterCounts.get(canonical) ?? 1;
        if (activeWaiters <= 1) watchStartWaiterCounts.delete(canonical);
        else watchStartWaiterCounts.set(canonical, activeWaiters - 1);
        if (
          activeWaiters <= 1
          && record?.owned
          && record.sessions.size === 0
          && watches.get(canonical) === record
        ) {
          watches.delete(canonical);
          stopOwnedWatch(record);
        }
      }
    })();
    sessionWatchStartPromises.set(sessionStartKey, sessionStart);
    try {
      return await sessionStart;
    } finally {
      if (sessionWatchStartPromises.get(sessionStartKey) === sessionStart) {
        sessionWatchStartPromises.delete(sessionStartKey);
      }
    }
  }
  const record = watches.get(file);
  if (!record || !(await externalWatchAlive(record))) {
    if (record) watches.delete(file);
    return previewError(
      ctx,
      ['preview', args.action, args.file],
      'watch_not_running',
      'conflict',
      'No live OfficeCLI watch is running for this file.',
      'Call office_document_preview with action=start first.',
      file,
    );
  }
  if (!record.sessions.has(ctx.sessionId)) {
    return previewError(
      ctx,
      ['preview', args.action, args.file],
      'watch_not_referenced',
      'conflict',
      'This session has not acquired a reference to the live OfficeCLI watch.',
      'Call office_document_preview with action=start in this session first.',
      file,
    );
  }
  let argv: string[];
  switch (args.action) {
    case 'selection':
      argv = ['get', args.file, 'selected'];
      break;
    case 'goto':
      if (!args.path?.trim()) return previewError(ctx, ['preview', 'goto'], 'path_required', 'input', 'goto requires a non-empty path.');
      argv = ['watch', args.file, 'goto', args.file, args.path];
      break;
    case 'mark':
      if (!args.path?.trim()) return previewError(ctx, ['preview', 'mark'], 'path_required', 'input', 'mark requires a non-empty path.');
      argv = ['watch', args.file, 'mark', args.file, args.path];
      for (const [key, value] of Object.entries(args.props ?? {})) argv.push('--prop', `${key}=${String(value)}`);
      break;
    case 'unmark':
      if (Boolean(args.all) === Boolean(args.path?.trim())) {
        return previewError(ctx, ['preview', 'unmark'], 'unmark_selector_required', 'input', 'unmark requires exactly one of path or all=true.');
      }
      argv = ['watch', args.file, 'unmark', args.file, ...(args.all ? ['--all'] : ['--path', args.path!])];
      break;
    case 'get_marks':
      argv = ['watch', args.file, 'marks', args.file];
      break;
    default:
      return previewError(ctx, ['preview', String((args as { action: string }).action)], 'unknown_preview_action', 'input', `Unknown preview action: ${(args as { action: string }).action}`);
  }
  const outcome = await executeOfficeCommand(
    ctx,
    { argv, mode: 'preview', mutation: false, cacheable: false },
    dependencies,
  );
  if (!outcome.envelope.ok) return officeToolResult(outcome.envelope);
  return interactiveEnvelope(ctx, args.action, args.file, {
    watchUrl: record.url,
    result: outcome.envelope.data,
  }, outcome.envelope);
}

export function releaseOfficePreviewSession(sessionId: string): void {
  previewSessionEpochs.set(sessionId, (previewSessionEpochs.get(sessionId) ?? 0) + 1);
  for (const [file, record] of watches) {
    record.sessions.delete(sessionId);
    if (record.sessions.size > 0) continue;
    watches.delete(file);
    stopOwnedWatch(record);
  }
}

export function clearOfficePreviewState(force = false): void {
  previewStateGeneration += 1;
  for (const child of pendingWatchChildren.values()) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  pendingWatchChildren.clear();
  for (const record of watches.values()) stopOwnedWatch(record, force);
  watches.clear();
  watchStartPromises.clear();
  sessionWatchStartPromises.clear();
  watchStartWaiterCounts.clear();
  previewSessionEpochs.clear();
}

process.once('exit', () => clearOfficePreviewState(true));
