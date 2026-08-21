import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import type { OfficeResultEnvelope } from '../office-types.ts';
import {
  executeOfficeCommand,
  clearOfficeRuntimeState,
  type OfficeCoordinatorDependencies,
} from '../runtime/office-coordinator.ts';
import { resolveOfficecliResources, reviewedOfficecliSchemaCrc } from '../runtime/office-manifest.ts';
import { handleOfficeDocumentFinalize as handleOfficeDocumentFinalizeImpl } from './office-finalize.ts';
import {
  clearOfficePreviewState,
  detectOfficeHtmlDependencies,
  handleOfficeDocumentPreview as handleOfficeDocumentPreviewImpl,
  releaseOfficePreviewSession,
} from './office-preview.ts';

const roots: string[] = [];
let previousRuntime: string | undefined;
const resources = resolveOfficecliResources({
  explicitRoot: resolve(import.meta.dir, '../../../../apps/electron/resources/officecli'),
});
if (!resources) throw new Error('OfficeCLI test resources are missing');
const expectedRuntimeSha256 = resources.manifest.assets[`${process.platform}-${process.arch}`]?.sha256;
if (!expectedRuntimeSha256) throw new Error(`OfficeCLI test asset is missing for ${process.platform}-${process.arch}`);
const expectedSchemaCrc = reviewedOfficecliSchemaCrc(resources.manifest);
const TEST_DEPENDENCIES: OfficeCoordinatorDependencies = {
  hashRuntime: async () => expectedRuntimeSha256!,
};

const handleOfficeDocumentPreview = (
  ctx: SessionToolContext,
  args: Parameters<typeof handleOfficeDocumentPreviewImpl>[1],
) => handleOfficeDocumentPreviewImpl(ctx, args, TEST_DEPENDENCIES);

const handleOfficeDocumentFinalize = (
  ctx: SessionToolContext,
  args: Parameters<typeof handleOfficeDocumentFinalizeImpl>[1],
) => handleOfficeDocumentFinalizeImpl(ctx, args, TEST_DEPENDENCIES);

const FAKE_RUNTIME = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const reply = (value, code = 0) => { process.stdout.write(JSON.stringify(value)); process.exit(code); };
if (args[0] === '--version') { process.stdout.write('1.0.144\\n'); process.exit(0); }
if (args[0] === '--output-schema-crc') { process.stdout.write('${expectedSchemaCrc}\\n'); process.exit(0); }
if (args[0] === 'watch' && args[2] === '--port') {
  const publish = () => process.stdout.write('Watch: http://127.0.0.1:45678\\n');
  if ((args[1] || '').includes('slow-watch')) setTimeout(publish, 100);
  else publish();
  setInterval(() => {}, 1000);
  return;
}
const file = args[1] || '';
if (args[0] === 'save' && file.includes('flush-fail')) {
  reply({ success: false, error: { code: 'save_failed', message: 'disk full' } }, 1);
}
if (args[0] === 'open' || args[0] === 'save' || args[0] === 'close') {
  if (args[0] === 'save' && file && fs.existsSync(file)) {
    fs.writeFileSync(file, fs.readFileSync(file));
  }
  reply({ success: true, data: { lease: args[0] } });
}
if (args[0] === 'validate' && file.includes('invalid')) {
  reply({ success: false, error: { code: 'validation_failed', message: 'OpenXML validation failed' } }, 1);
}
if (args[0] === 'view' && args[2] === 'issues') {
  const issues = file.includes('issue')
    ? [{ id: 'F0', severity: 0, path: '/body/p[1]', message: 'Blocking format defect' }]
    : [];
  reply({ success: true, data: { count: issues.length, issues } });
}
if (args[0] === 'view' && args[2] === 'outline') {
  if (file.endsWith('.docx')) {
    reply({ success: true, data: file.includes('empty')
      ? { paragraphs: 0, tables: 0, images: 0, equations: 0, headings: [] }
      : { paragraphs: 2, tables: 0, images: 0, equations: 0, headings: [] } });
  }
  if (file.endsWith('.xlsx')) {
    reply({ success: true, data: { sheets: file.includes('empty')
      ? [{ name: 'Sheet1', rows: 0, cols: 0, formulas: 0, tables: 0, charts: 0, oleObjects: 0 }]
      : [{ name: 'Sheet1', rows: 2, cols: 2, formulas: 1, tables: 0, charts: 0, oleObjects: 0 }] } });
  }
  reply({ success: true, data: { totalSlides: file.includes('empty') ? 0 : 2, slides: [] } });
}
if (args[0] === 'view' && args[2] === 'html') {
  const output = args[args.indexOf('--out') + 1];
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const dependency = file.includes('equation')
    ? '<script src="https://d.officecli.ai/assets/katex-0.16.11/katex.min.js"></script>'
    : '<p>self-contained preview</p>';
  fs.writeFileSync(output, '<!doctype html>' + dependency);
  reply({ success: true, data: { path: output } });
}
if (args[0] === 'view' && args[2] === 'screenshot') {
  const renderer = args[args.indexOf('--render') + 1];
  if (renderer === 'native') {
    reply({ success: false, error: { code: 'native_unavailable', message: 'Native renderer unavailable' } }, 1);
  }
  if (file.includes('all-renderers-fail')) {
    reply({ success: false, error: { code: 'html_unavailable', message: 'HTML renderer unavailable' } }, 1);
  }
  const output = args[args.indexOf('--out') + 1];
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  if (file.includes('changes-during-finalize')) fs.appendFileSync(file, 'changed');
  reply({ success: true, data: { rendered: true, backend: file.includes('actual-backend') ? 'fake-html-engine' : undefined } });
}
if (args[0] === 'validate') reply({ success: true, data: 'Validation passed' });
if (args[0] === 'get') reply({ success: true, data: { path: args[2], children: [] } });
reply({ success: true, data: { argv: args, backend: args[0] === 'refresh' ? 'fake-native' : undefined } });
`;

interface TestWorkspace {
  root: string;
  workspace: string;
  working: string;
  runtime: string;
}

function workspace(): TestWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'selection-office-preview-'));
  roots.push(root);
  const workspacePath = join(root, 'workspace');
  const working = join(workspacePath, 'project');
  mkdirSync(working, { recursive: true });
  const runtime = join(root, 'fake-officecli');
  writeFileSync(runtime, FAKE_RUNTIME);
  chmodSync(runtime, 0o755);
  process.env.CRAFT_OFFICECLI = runtime;
  return { root, workspace: workspacePath, working, runtime };
}

function context(
  testWorkspace: TestWorkspace,
  sessionId: string,
  openOfficePreview?: (url: string) => Promise<{ url: string; instanceId?: string }>,
): SessionToolContext {
  const sessionPath = join(testWorkspace.workspace, 'sessions', sessionId);
  mkdirSync(join(sessionPath, 'data'), { recursive: true });
  return {
    sessionId,
    workspacePath: testWorkspace.workspace,
    sessionPath,
    dataPath: join(sessionPath, 'data'),
    workingDirectory: testWorkspace.working,
    get sourcesPath() { return join(testWorkspace.workspace, 'sources'); },
    get skillsPath() { return join(testWorkspace.workspace, 'skills'); },
    plansFolderPath: join(sessionPath, 'plans'),
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: createNodeFileSystem(),
    loadSourceConfig: () => null,
    ...(openOfficePreview ? { openOfficePreview } : {}),
  };
}

function document(testWorkspace: TestWorkspace, name: string): string {
  const file = join(testWorkspace.working, name);
  writeFileSync(file, Buffer.concat([Buffer.from('PK'), Buffer.alloc(30)]));
  return file;
}

function envelope(result: { structuredContent?: Record<string, unknown> }): OfficeResultEnvelope {
  return result.structuredContent as OfficeResultEnvelope;
}

beforeEach(() => {
  previousRuntime = process.env.CRAFT_OFFICECLI;
  clearOfficeRuntimeState();
  clearOfficePreviewState();
});

afterEach(() => {
  clearOfficePreviewState();
  clearOfficeRuntimeState();
  if (previousRuntime === undefined) delete process.env.CRAFT_OFFICECLI;
  else process.env.CRAFT_OFFICECLI = previousRuntime;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('office_document_preview', () => {
  it('detects only the reviewed HTML dependency families', () => {
    expect(detectOfficeHtmlDependencies(`
      <link href="https://d.officecli.ai/assets/katex-0.16.11/katex.min.css">
      <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0.1/dist/index.mjs"></script>
      <script type="importmap">{"imports":{"three":"https://d.officecli.ai/assets/three-0.170.0/build/three.module.js"}}</script>
    `)).toEqual(['katex', 'mermaid', 'mermaid-layout-elk', 'three']);
    expect(detectOfficeHtmlDependencies('<p>ordinary self-contained document</p>')).toEqual([]);
  });

  it('renders bounded inline image + full artifact without opening BrowserPane', async () => {
    const w = workspace();
    let openCount = 0;
    const ctx = context(w, 'render-session', async url => {
      openCount += 1;
      return { url };
    });
    const file = document(w, '报告 with spaces.docx');
    const result = await handleOfficeDocumentPreview(ctx, {
      action: 'render', file, page: '1', renderer: 'html',
    });
    const payload = envelope(result);
    const image = result.content.find(block => block.type === 'image');

    expect(payload).toMatchObject({ ok: true, backend: 'html', documentPath: realpathSync.native(file) });
    expect(openCount).toBe(0);
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(image && image.type === 'image' ? Buffer.from(image.data, 'base64').length : 0).toBeGreaterThan(0);
    expect(payload.artifacts.filter(artifact => artifact.kind === 'image')).toHaveLength(2);
    for (const artifact of payload.artifacts.filter(item => item.kind === 'image')) {
      expect(artifact.path).toContain(join('data', 'office'));
      expect(existsSync(artifact.path)).toBe(true);
    }
    expect(result.content[0].text).toContain('```image-preview');
  });

  it('rejects contradictory contact-sheet selectors and unsupported Excel grids before execution', async () => {
    const w = workspace();
    const ctx = context(w, 'invalid-render-session');
    const deck = document(w, 'deck.pptx');
    const workbook = document(w, 'book.xlsx');

    const conflict = envelope(await handleOfficeDocumentPreview(ctx, {
      action: 'render', file: deck, page: '1', grid: 'auto',
    }));
    const unsupported = envelope(await handleOfficeDocumentPreview(ctx, {
      action: 'render', file: workbook, grid: 3,
    }));

    expect(conflict).toMatchObject({
      ok: false,
      error: { code: 'render_selector_conflict', category: 'input' },
      artifacts: [],
    });
    expect(unsupported).toMatchObject({
      ok: false,
      error: { code: 'xlsx_contact_sheet_unsupported', category: 'unsupported' },
      artifacts: [],
    });
    expect(existsSync(join(ctx.dataPath!, 'office'))).toBe(false);
  });

  it('authorizes the input document before creating the Office artifact directory', async () => {
    const w = workspace();
    const ctx = context(w, 'missing-render-session');

    const missing = envelope(await handleOfficeDocumentPreview(ctx, {
      action: 'render', file: join(w.working, 'missing.docx'), renderer: 'html',
    }));

    expect(missing).toMatchObject({
      ok: false,
      error: { code: 'file_not_found', category: 'path' },
      artifacts: [],
    });
    expect(existsSync(join(ctx.dataPath!, 'office'))).toBe(false);
  });

  it('records native failure and truthful HTML fallback for auto rendering', async () => {
    const w = workspace();
    const ctx = context(w, 'fallback-session');
    const file = document(w, 'fallback.pptx');
    const result = await handleOfficeDocumentPreview(ctx, { action: 'render', file, grid: 'auto' });

    expect(envelope(result).backend).toBe('html');
    expect(envelope(result).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'native_renderer_unavailable' }),
    ]));

    const actualFile = document(w, 'actual-backend.pptx');
    const actual = envelope(await handleOfficeDocumentPreview(ctx, {
      action: 'render', file: actualFile, renderer: 'html',
    }));
    expect(actual.backend).toBe('fake-html-engine');
    expect(actual.data).toMatchObject({ render: { backend: 'fake-html-engine' } });

    const failedFile = document(w, 'all-renderers-fail.pptx');
    const failed = envelope(await handleOfficeDocumentPreview(ctx, { action: 'render', file: failedFile }));
    expect(failed.error).toMatchObject({
      code: 'dependency_unavailable',
      category: 'dependency',
      upstreamCode: 'html_unavailable',
    });
    expect(failed.backend).toBe('html');
    expect(failed.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'native_renderer_unavailable' }),
    ]));
  });

  it('marks network-backed HTML output as degraded in deterministic offline mode', async () => {
    const w = workspace();
    const ctx = context(w, 'offline-session');
    const file = document(w, 'equation.docx');
    const previous = process.env.CRAFT_OFFLINE;
    process.env.CRAFT_OFFLINE = '1';
    try {
      const result = await handleOfficeDocumentPreview(ctx, { action: 'render', file, renderer: 'html' });
      const payload = envelope(result);
      expect(payload.ok).toBe(true);
      expect(payload.data).toMatchObject({
        render: { dependencyState: 'degraded', externalDependencies: ['katex'] },
      });
      expect(payload.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'offline_render_degraded', severity: 'high' }),
      ]));
      expect(payload.artifacts.some(artifact => artifact.kind === 'html')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.CRAFT_OFFLINE;
      else process.env.CRAFT_OFFLINE = previous;
    }
  });

  it('makes start the only BrowserPane-opening action and reference-counts one watch across sessions', async () => {
    const w = workspace();
    const opened: string[] = [];
    const open = async (url: string) => {
      opened.push(url);
      return { url, instanceId: `pane-${opened.length}` };
    };
    const firstCtx = context(w, 'watch-a', open);
    const secondCtx = context(w, 'watch-b', open);
    const file = document(w, 'watch.pptx');

    const before = await handleOfficeDocumentPreview(firstCtx, { action: 'status', file });
    const first = await handleOfficeDocumentPreview(firstCtx, { action: 'start', file });
    const second = await handleOfficeDocumentPreview(secondCtx, { action: 'start', file });
    const mark = await handleOfficeDocumentPreview(firstCtx, {
      action: 'mark', file, path: '/slide[1]/shape[2]', props: { color: '#FF0000' },
    });
    const stopFirst = await handleOfficeDocumentPreview(firstCtx, { action: 'stop', file });
    const stillRunning = await handleOfficeDocumentPreview(secondCtx, { action: 'status', file });
    const stopSecond = await handleOfficeDocumentPreview(secondCtx, { action: 'stop', file });

    expect((envelope(before).data as { running: boolean }).running).toBe(false);
    expect(opened).toHaveLength(2);
    expect(opened.every(url => url === 'http://127.0.0.1:45678/')).toBe(true);
    expect(envelope(second).data).toMatchObject({ reused: true, sessionReferences: 2 });
    expect((envelope(mark).data as { result: { argv: string[] } }).result.argv).toEqual(expect.arrayContaining([
      'watch', file, 'mark', file, '/slide[1]/shape[2]', '--prop', 'color=#FF0000',
    ]));
    expect(envelope(stopFirst).data).toMatchObject({ stopped: false, remainingSessionReferences: 1 });
    expect(envelope(stillRunning).data).toMatchObject({ running: true, sessionReferences: 1 });
    expect(envelope(stopSecond).data).toMatchObject({ stopped: true, remainingSessionReferences: 0 });
    expect(envelope(first).backend).toBe('officecli-watch');
  });

  it('single-flights concurrent watch starts and preserves an existing reference when reopening the pane fails', async () => {
    const w = workspace();
    const file = document(w, 'watch-race.pptx');
    const firstCtx = context(w, 'watch-race-a', async url => ({ url }));
    const secondCtx = context(w, 'watch-race-b', async url => ({ url }));

    const [first, second] = await Promise.all([
      handleOfficeDocumentPreview(firstCtx, { action: 'start', file }),
      handleOfficeDocumentPreview(secondCtx, { action: 'start', file }),
    ]);
    const firstStatus = envelope(await handleOfficeDocumentPreview(firstCtx, { action: 'status', file }));
    const secondStatus = envelope(await handleOfficeDocumentPreview(secondCtx, { action: 'status', file }));

    expect(envelope(first).data).toMatchObject({ running: true });
    expect(envelope(second).data).toMatchObject({ running: true });
    expect(firstStatus.data).toMatchObject({
      running: true,
      currentSessionReferenced: true,
      sessionReferences: 2,
    });
    expect(secondStatus.data).toMatchObject({
      running: true,
      currentSessionReferenced: true,
      sessionReferences: 2,
    });

    let reopenCount = 0;
    const reopenCtx = context(w, 'watch-race-a', async url => {
      reopenCount += 1;
      if (reopenCount === 1) throw new Error('pane unavailable');
      return { url };
    });
    const failedReopen = envelope(await handleOfficeDocumentPreview(reopenCtx, { action: 'start', file }));
    const afterFailure = envelope(await handleOfficeDocumentPreview(firstCtx, { action: 'status', file }));

    expect(failedReopen.error?.code).toBe('browser_pane_open_failed');
    expect(afterFailure.data).toMatchObject({
      running: true,
      currentSessionReferenced: true,
      sessionReferences: 2,
    });

    await handleOfficeDocumentPreview(firstCtx, { action: 'stop', file });
    await handleOfficeDocumentPreview(secondCtx, { action: 'stop', file });
  });

  it('single-flights duplicate starts from the same session through BrowserPane acquisition', async () => {
    const w = workspace();
    const file = document(w, 'slow-watch-same-session.pptx');
    let openCount = 0;
    const ctx = context(w, 'same-session-watch-race', async url => {
      openCount += 1;
      return { url };
    });

    const [first, second] = await Promise.all([
      handleOfficeDocumentPreview(ctx, { action: 'start', file }),
      handleOfficeDocumentPreview(ctx, { action: 'start', file }),
    ]);
    const status = envelope(await handleOfficeDocumentPreview(ctx, { action: 'status', file }));

    expect(envelope(first).ok).toBe(true);
    expect(envelope(second).ok).toBe(true);
    expect(openCount).toBe(1);
    expect(status.data).toMatchObject({
      running: true,
      currentSessionReferenced: true,
      sessionReferences: 1,
    });

    await handleOfficeDocumentPreview(ctx, { action: 'stop', file });
  });

  it('does not attach a released session while preserving another waiter on the shared watch start', async () => {
    const w = workspace();
    const file = document(w, 'slow-watch.pptx');
    const releasedCtx = context(w, 'released-during-start', async url => ({ url }));
    const survivorCtx = context(w, 'survives-shared-start', async url => ({ url }));

    const releasedPending = handleOfficeDocumentPreview(releasedCtx, { action: 'start', file });
    const survivorPending = handleOfficeDocumentPreview(survivorCtx, { action: 'start', file });
    releaseOfficePreviewSession(releasedCtx.sessionId);
    const [released, survivor] = await Promise.all([releasedPending, survivorPending]);
    const releasedStatus = envelope(await handleOfficeDocumentPreview(releasedCtx, { action: 'status', file }));
    const survivorStatus = envelope(await handleOfficeDocumentPreview(survivorCtx, { action: 'status', file }));

    expect(envelope(released).error?.code).toBe('preview_session_released');
    expect(envelope(survivor).ok).toBe(true);
    expect(releasedStatus.data).toMatchObject({
      running: true,
      currentSessionReferenced: false,
      sessionReferences: 1,
    });
    expect(survivorStatus.data).toMatchObject({
      running: true,
      currentSessionReferenced: true,
      sessionReferences: 1,
    });

    await handleOfficeDocumentPreview(survivorCtx, { action: 'stop', file });
  });

  it('does not report a stale start after preview state is cleared during BrowserPane acquisition', async () => {
    const w = workspace();
    const file = document(w, 'clear-during-browser-open.pptx');
    let announceOpen!: () => void;
    let finishOpen!: () => void;
    const opening = new Promise<void>(resolvePromise => { announceOpen = resolvePromise; });
    const opened = new Promise<void>(resolvePromise => { finishOpen = resolvePromise; });
    const ctx = context(w, 'clear-during-browser-open', async url => {
      announceOpen();
      await opened;
      return { url };
    });

    const pending = handleOfficeDocumentPreview(ctx, { action: 'start', file });
    await opening;
    clearOfficePreviewState(true);
    finishOpen();
    const result = envelope(await pending);
    const status = envelope(await handleOfficeDocumentPreview(ctx, { action: 'status', file }));

    expect(result.error?.code).toBe('preview_state_cleared');
    expect(status.data).toEqual({ running: false });
  });

  it('does not leak or mutate a watch through an unreferenced or out-of-scope session path', async () => {
    const w = workspace();
    const open = async (url: string) => ({ url });
    const owner = context(w, 'watch-owner', open);
    const observer = context(w, 'watch-observer', open);
    const file = document(w, 'private-watch.pptx');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'selection-office-preview-outside-'));
    roots.push(outsideRoot);
    const outside = join(outsideRoot, 'outside.pptx');
    writeFileSync(outside, Buffer.concat([Buffer.from('PK'), Buffer.alloc(30)]));

    await handleOfficeDocumentPreview(owner, { action: 'start', file });
    const observed = envelope(await handleOfficeDocumentPreview(observer, { action: 'status', file }));
    const unreferencedStop = envelope(await handleOfficeDocumentPreview(observer, { action: 'stop', file }));
    const unreferencedMark = envelope(await handleOfficeDocumentPreview(observer, {
      action: 'mark', file, path: '/slide[1]/shape[1]',
    }));
    const outsideStatus = envelope(await handleOfficeDocumentPreview(observer, { action: 'status', file: outside }));
    const ownerStatus = envelope(await handleOfficeDocumentPreview(owner, { action: 'status', file }));

    expect(observed.data).toMatchObject({ running: true, currentSessionReferenced: false });
    expect((observed.data as Record<string, unknown>).url).toBeUndefined();
    expect(unreferencedStop.data).toMatchObject({ stopped: false, reason: 'not_referenced_by_session' });
    expect(unreferencedMark.error?.code).toBe('watch_not_referenced');
    expect(outsideStatus.error?.code).toBe('path_outside_allowed_roots');
    expect(ownerStatus.data).toMatchObject({ running: true, currentSessionReferenced: true });

    await handleOfficeDocumentPreview(owner, { action: 'stop', file });
  });

  it('returns interactive_preview_unavailable in headless mode while status/stop remain safe', async () => {
    const w = workspace();
    const ctx = context(w, 'headless');
    const file = document(w, 'headless.docx');
    const selection = await handleOfficeDocumentPreview(ctx, { action: 'selection', file });
    const status = await handleOfficeDocumentPreview(ctx, { action: 'status', file });

    expect(envelope(selection).error?.code).toBe('interactive_preview_unavailable');
    expect(envelope(status).data).toEqual({ running: false });
  });

  it('rejects an unknown preview action before reporting desktop capability', async () => {
    const w = workspace();
    const ctx = context(w, 'unknown-preview-action');
    const file = document(w, 'unknown.docx');

    const result = envelope(await handleOfficeDocumentPreview(ctx, {
      action: 'launch' as never,
      file,
    }));

    expect(result.error).toMatchObject({ code: 'unknown_preview_action', category: 'input' });
  });

  it('releases Selection-owned watches when a session ends', async () => {
    const w = workspace();
    const ctx = context(w, 'release-session', async url => ({ url }));
    const file = document(w, 'release.docx');
    await handleOfficeDocumentPreview(ctx, { action: 'start', file });
    releaseOfficePreviewSession(ctx.sessionId);
    const status = await handleOfficeDocumentPreview(ctx, { action: 'status', file });
    expect(envelope(status).data).toEqual({ running: false });
  });
});

describe('office_document_finalize', () => {
  it('rejects an invalid profile instead of silently weakening it to standard', async () => {
    const w = workspace();
    const ctx = context(w, 'invalid-finalize-profile');
    const file = document(w, 'profile.docx');

    const result = envelope(await handleOfficeDocumentFinalize(ctx, {
      file,
      profile: 'relaxed' as never,
    }));

    expect(result).toMatchObject({
      ok: false,
      deliveryReady: false,
      error: { code: 'invalid_finalize_profile', category: 'input' },
    });
  });

  it('blocks strict delivery but keeps offline HTML degradation non-blocking under standard', async () => {
    const w = workspace();
    const ctx = context(w, 'offline-finalize');
    const file = document(w, 'equation.docx');
    const previous = process.env.CRAFT_OFFLINE;
    process.env.CRAFT_OFFLINE = '1';
    try {
      const strict = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
      const standard = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' }));
      expect(strict).toMatchObject({ ok: false, deliveryReady: false });
      expect(strict.evidence?.checks.find(check => check.name === 'final_render')).toMatchObject({
        ok: false,
        blocking: true,
        error: { code: 'dependency_unavailable' },
      });
      expect(standard).toMatchObject({ ok: true, deliveryReady: true });
      expect(standard.evidence?.checks.find(check => check.name === 'final_render')).toMatchObject({
        ok: false,
        blocking: false,
      });
    } finally {
      if (previous === undefined) delete process.env.CRAFT_OFFLINE;
      else process.env.CRAFT_OFFLINE = previous;
    }
  });

  it('defaults current-session mutations to strict and returns revision-bound render evidence', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-strict');
    const file = document(w, 'deliverable.docx');
    const edit = await executeOfficeCommand(ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=updated'],
      mode: 'edit',
      mutation: true,
    }, TEST_DEPENDENCIES);
    expect(edit.envelope.ok).toBe(true);

    const result = await handleOfficeDocumentFinalize(ctx, { file });
    const payload = envelope(result);

    expect(payload).toMatchObject({
      ok: true,
      deliveryReady: true,
      backend: 'html',
    });
    expect(payload.data).toEqual(expect.objectContaining({
      residentFlush: 'selection_lease_saved',
    }));
    expect(payload.evidence).toMatchObject({ profile: 'strict', artifactRevision: payload.artifactRevision });
    expect(payload.evidence?.checks.find(check => check.name === 'artifact_revision_current')).toMatchObject({
      ok: true,
      data: expect.objectContaining({
        revisionAtStart: payload.artifactRevision,
        revisionAtEnd: payload.artifactRevision,
      }),
    });
    expect(payload.evidence?.checks.every(check => !check.blocking || check.ok)).toBe(true);
    expect(payload.data).toMatchObject({
      gate: 'machine',
      claim: 'machine_gates_passed',
      humanMicrosoftOfficeVisualApproval: false,
    });
    expect(result.content.some(block => block.type === 'image')).toBe(true);
  });

  it('treats high-severity issues as blocking only under strict profile', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-profiles');
    const file = document(w, 'issue.docx');
    const standard = await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' });
    const strict = await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' });

    expect(envelope(standard)).toMatchObject({ ok: true, deliveryReady: true });
    expect(envelope(standard).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'office_issue_F0', severity: 'high' }),
    ]));
    expect(envelope(strict)).toMatchObject({
      ok: false,
      deliveryReady: false,
      error: { code: 'finalization_blocked' },
    });
  });

  it('invalidates evidence when the artifact changes during final rendering', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-race');
    const file = document(w, 'changes-during-finalize.pptx');
    const before = readFileSync(file).length;
    const result = await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' });
    const revisionCheck = envelope(result).evidence?.checks.find(check => check.name === 'artifact_revision_current');

    expect(readFileSync(file).length).toBeGreaterThan(before);
    expect(envelope(result).deliveryReady).toBe(false);
    expect(revisionCheck).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'artifact_changed_during_finalize' },
    });
  });

  it('does not silently refresh or mutate the finalized file', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-no-refresh');
    const file = document(w, 'read-only-external.xlsx');
    const before = readFileSync(file);
    const result = await handleOfficeDocumentFinalize(ctx, { file });
    const after = readFileSync(file);

    expect(envelope(result).evidence?.profile).toBe('standard');
    expect(after.equals(before)).toBe(true);
    expect(envelope(result).command).not.toContain('refresh');
  });

  it('blocks finalization when the resident lease cannot be flushed', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-flush-fail');
    const file = document(w, 'flush-fail.docx');
    await executeOfficeCommand(ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=draft'],
      mode: 'edit',
      mutation: true,
    }, TEST_DEPENDENCIES);

    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result).toMatchObject({
      ok: false,
      deliveryReady: false,
      data: { residentFlush: 'selection_lease_flush_failed' },
    });
    expect(result.evidence?.checks.some(check => check.name === 'resident_flush' && check.ok === false)).toBe(true);
  });

  it('blocks a structurally valid but empty Office package at the key-content gate', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-empty');
    const file = document(w, 'empty.docx');

    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
    const contentCheck = result.evidence?.checks.find(check => check.name === 'key_content_summary');

    expect(result.deliveryReady).toBe(false);
    expect(contentCheck).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'empty_or_unrecognized_content' },
    });
  });
});
