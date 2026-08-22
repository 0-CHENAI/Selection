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
import { compileDocxTocIfPresent } from '../runtime/office-docx-fields.ts';
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
if (file && !args[0].startsWith('--')) {
  const label = args[0] === 'view' && args[2] === 'screenshot'
    ? (args.includes('--grid') ? 'screenshot-grid' : 'screenshot')
    : args[0];
  try { fs.appendFileSync(file + '.officecli.log', label + '\\n'); } catch {}
}
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
  const issues = file.includes('indent-false-positive')
    ? [{ id: 'I1', severity: 0, path: '/body/p[1]', message: 'Cover title uses first-line indent' }]
    : file.includes('issue')
      ? [{ id: 'F0', severity: 0, path: '/body/p[1]', message: 'Blocking format defect' }]
      : [];
  reply({ success: true, data: { count: issues.length, issues } });
}
if (args[0] === 'view' && args[2] === 'outline') {
  if (file.endsWith('.docx')) {
    const empty = file.includes('empty');
    const threeHeadings = file.includes('has-three-headings');
    const normalOnly = file.includes('normal-only');
    const smallHeading = file.includes('small-heading');
    const twoHeadingLong = file.includes('two-heading-long');
    const tocHeading = { line: 1, text: '目录', style: 'TOCHeading', level: 1 };
    const heading = { line: 3, text: '第一章', style: 'Heading1', level: 1 };
    const headings = empty
      ? []
      : smallHeading
        ? [{ line: 1, text: '标题', style: 'Heading1', level: 1 }]
        : twoHeadingLong
          ? [
              { line: 1, text: '一', style: 'Heading1', level: 1 },
              { line: 3, text: '二', style: 'Heading1', level: 1 },
            ]
          : file.includes('has-toc-no-headings')
            ? [tocHeading]
            : threeHeadings
              ? [
                  { line: 1, text: '概述', style: 'Heading1', level: 1 },
                  { line: 2, text: '方法', style: 'Heading2', level: 2 },
                  { line: 3, text: '结论', style: 'Heading3', level: 3 },
                  ...(file.includes('has-toc') ? [tocHeading] : []),
                ]
              : file.includes('has-toc')
                ? [tocHeading, heading]
                : [];
    reply({ success: true, data: {
      paragraphs: empty ? 0 : (threeHeadings || normalOnly ? 6 : twoHeadingLong ? 10 : smallHeading ? 4 : 2),
      tables: 0,
      images: 0,
      equations: 0,
      headings,
    } });
  }
  if (file.endsWith('.xlsx')) {
    reply({ success: true, data: { sheets: file.includes('empty')
      ? [{ name: 'Sheet1', rows: 0, cols: 0, formulas: 0, tables: 0, charts: 0, oleObjects: 0 }]
      : file.includes('dashboard')
        ? [
            { name: 'Dashboard', rows: 4, cols: 8, formulas: 3, tables: 0, charts: 1, oleObjects: 0 },
            { name: 'Data', rows: 12, cols: 4, formulas: 0, tables: 0, charts: 0, oleObjects: 0 },
          ]
        : [{ name: 'Sheet1', rows: 2, cols: 2, formulas: file.includes('values-only') ? 0 : 1, tables: 0, charts: 0, oleObjects: 0 }] } });
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
if (args[0] === 'view' && args[2] === 'text') {
  reply({ success: true, data: file.includes('academic-cite')
    ? 'See [1] and [2]. References. Figure 1'
    : file.includes('form-sdt')
      ? 'Name ______ TBD (fill in)'
      : file.includes('hash-clip')
        ? 'Revenue ###'
        : file.includes('pitch-strip')
          ? 'Raised  M ARR last quarter'
          : file.includes('morph-price')
            ? '!!actor-hero \${PRICE}'
            : file.includes('empty-parens')
              ? 'See () and [] leftovers'
              : file.includes('brace-var')
              ? 'Body {var} ipsum placeholder this slide layout'
              : file.includes('leak')
                ? 'Title $TITLE$ and {{placeholder}} <TODO> xxxx lorem {var}'
                : file.includes('has-toc-refresh-fail')
                  ? 'Update field to see table of contents'
                  : file.includes('has-toc')
                    ? '目录\\n第一章 概述\\t2'
                    : 'Quarterly report body' });
}
if (args[0] === 'refresh') {
  if (file.includes('has-toc-refresh-fail')) {
    reply({ success: false, error: { code: 'refresh_failed', message: 'No field engine' } }, 1);
  }
  if (file && !file.includes('has-toc-no-headings')) fs.writeFileSync(file + '.refreshed', '1');
  reply({ success: true, data: 'Refreshed: ' + file + ' (backend: word)' });
}
if (args[0] === 'query') {
  const selector = args[2] || '';
  if (/cell:contains/i.test(selector)) {
    const hit = (file.includes('excel-error') && /#REF!|#DIV\\/0!|#VALUE!|#NAME\\?|#N\\/A/.test(selector))
      || (file.includes('imbalanced') && /IMBALANCED/.test(selector));
    reply({ success: true, data: hit
      ? { matches: 1, results: [{ type: 'cell', text: file.includes('imbalanced') ? 'IMBALANCED' : '#REF!' }] }
      : { matches: 0, results: [] } });
  }
  if (/field\[fieldType=page\]/i.test(selector)) {
    reply({ success: true, data: file.includes('has-page')
      ? { matches: 1, results: [{ type: 'field', fieldType: 'page' }] }
      : { matches: 0, results: [] } });
  }
  if (/Heading1|Heading2|Heading3/.test(selector)) {
    reply({ success: true, data: file.includes('small-heading')
      ? { matches: 1, results: [{ type: 'paragraph', style: 'Heading1', text: '标题', format: { style: 'Heading1', size: '11pt' } }] }
      : file.includes('has-toc-no-headings')
        ? { matches: 0, results: [] }
        : file.includes('has-toc')
          ? { matches: 2, results: [{ type: 'paragraph', style: 'Heading1', text: '第一章' }] }
          : { matches: 0, results: [] } });
  }
  if (/TOC1|TOC2|TOC3/.test(selector)) {
    const compiled = file.includes('has-toc-compiled') || (file && fs.existsSync(file + '.refreshed'));
    reply({ success: true, data: compiled
      ? { matches: 1, results: [{ type: 'paragraph', style: 'TOC1', text: '第一章\\t2' }] }
      : { matches: 0, results: [] } });
  }
  if (/paragraph\[hangingIndent\]/.test(selector)) {
    reply({ success: true, data: file.includes('academic-cite-ok')
      ? { matches: 2, results: [{}, {}] }
      : file.includes('academic-cite')
        ? { matches: 1, results: [{}] }
        : { matches: 0, results: [] } });
  }
  if (/field\[fieldType=seq\]/.test(selector)) {
    reply({ success: true, data: file.includes('academic-cite-ok')
      ? { matches: 1, results: [{ type: 'field', fieldType: 'seq' }] }
      : { matches: 0, results: [] } });
  }
  if (selector === 'sdt') {
    reply({ success: true, data: file.includes('form-sdt')
      ? { matches: 1, results: [{ format: { type: 'text' } }] }
      : { matches: 0, results: [] } });
  }
  if (selector === 'formfield') {
    reply({ success: true, data: { matches: 0, results: [] } });
  }
  if (selector === 'field') {
    reply({ success: true, data: { matches: 0, results: [] } });
  }
  if (selector === 'chart') {
    reply({ success: true, data: file.includes('dashboard')
      ? { matches: 1, results: [{ path: '/Dashboard/chart[1]', format: { seriesCount: 1, title: 'Revenue' }, children: [{ type: 'series', format: { name: 'Series1' } }] }] }
      : { matches: 0, results: [] } });
  }
  if (selector === 'conditionalformatting' || selector === 'namedrange' || selector === 'sheet') {
    reply({ success: true, data: selector === 'sheet' && file.includes('dashboard')
      ? { matches: 2, results: [{ path: '/Dashboard', preview: 'Dashboard' }, { path: '/Data', preview: 'Data' }] }
      : { matches: 0, results: [] } });
  }
  if (selector.includes('Dashboard!') && selector.includes('has(formula)')) {
    reply({ success: true, data: file.includes('dashboard')
      ? { matches: 3, results: [{}, {}, {}] }
      : { matches: 0, results: [] } });
  }
  if (/shape:contains/.test(selector)) {
    reply({ success: true, data: { matches: 0, results: [] } });
  }
  if (selector.includes('shape[x>=34cm]')) {
    reply({ success: true, data: { matches: 0, results: [] } });
  }
  reply({ success: true, data: { matches: 0, results: [] } });
}
if (args[0] === 'get' && (args[2] === '/toc' || args[2] === '/tableofcontents')) {
  if (file.includes('has-toc')) {
    reply({ success: true, data: { matches: 1, results: [{ path: '/toc', type: 'toc', text: 'TOC \\\\o "1-3" \\\\h \\\\u' }] } });
  }
  reply({ success: true, data: { matches: 0, results: [] } });
}
if (args[0] === 'get' && args[2] === '/workbook') {
  reply({ success: true, data: { format: { activeTab: file.includes('dashboard') ? 1 : 0, 'calc.fullCalcOnLoad': false } } });
}
if (args[0] === 'get' && (args[2] || '').includes('/Dashboard/chart')) {
  reply({ success: true, data: { results: [{ path: args[2], format: { seriesCount: 1, title: 'Revenue' }, children: [{ type: 'series', format: { name: 'Series1' } }] }] } });
}
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

function officecliVerbs(file: string): string[] {
  return existsSync(`${file}.officecli.log`)
    ? readFileSync(`${file}.officecli.log`, 'utf8').trim().split('\n').filter(Boolean)
    : [];
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

  it('records native failure and truthful HTML fallback when native screenshots are available', async () => {
    const w = workspace();
    const ctx = context(w, 'fallback-session');
    const nativeDeps = { ...TEST_DEPENDENCIES, nativeScreenshotAvailable: true };
    const file = document(w, 'fallback.pptx');
    const result = await handleOfficeDocumentPreviewImpl(ctx, { action: 'render', file, grid: 'auto' }, nativeDeps);

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
    const failed = envelope(await handleOfficeDocumentPreviewImpl(ctx, { action: 'render', file: failedFile }, nativeDeps));
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

  it('skips native screenshot attempts when desktop Word is unavailable', async () => {
    const w = workspace();
    const ctx = context(w, 'html-only-session');
    const file = document(w, 'html-only.pptx');
    const result = envelope(await handleOfficeDocumentPreviewImpl(ctx, {
      action: 'render', file, grid: 'auto',
    }, { ...TEST_DEPENDENCIES, nativeScreenshotAvailable: false }));

    expect(result.backend).toBe('html');
    expect(result.warnings ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'native_renderer_unavailable' }),
    ]));
    expect(officecliVerbs(file).filter(verb => verb.startsWith('screenshot'))).toEqual(['screenshot-grid']);
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

  it('keeps offline HTML degradation non-blocking under both profiles', async () => {
    const w = workspace();
    const ctx = context(w, 'offline-finalize');
    const file = document(w, 'equation.docx');
    const previous = process.env.CRAFT_OFFLINE;
    process.env.CRAFT_OFFLINE = '1';
    try {
      const strict = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
      const standard = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' }));
      expect(strict).toMatchObject({ ok: true, deliveryReady: true });
      expect(strict.evidence?.checks.find(check => check.name === 'final_render')).toMatchObject({
        ok: false,
        blocking: false,
        error: { code: 'dependency_unavailable' },
      });
      expect(strict.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'visual_not_verified' }),
      ]));
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
    expect(envelope(result).evidence?.checks.some(check => check.name === 'docx_field_refresh')).toBe(false);
  });

  it('does not compile fields on a Word file that has no TOC', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-no-toc');
    const file = document(w, 'plain-report.docx');
    const before = readFileSync(file);
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' }));

    expect(result.deliveryReady).toBe(true);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(result.command).not.toContain('refresh');
    expect(result.evidence?.checks.some(check => check.name === 'docx_field_refresh')).toBe(false);
  });

  it('defers TOC pagination when Word COM is unavailable instead of launching a browser', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-has-toc');
    const file = document(w, 'has-toc.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' }));
    const refreshCheck = result.evidence?.checks.find(check => check.name === 'docx_field_refresh');

    expect(result.command[0]).toBe('finalize');
    expect(result.command).not.toContain('refresh');
    expect(result.deliveryReady).toBe(true);
    expect(refreshCheck).toMatchObject({
      ok: false,
      blocking: false,
      data: { status: 'deferred', action: 'defer_to_word', updateFields: true, fallback: true },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'docx_toc_deferred', severity: 'medium' }),
    ]));
    expect(result.warnings.some(warning => /no match for style='TOC/i.test(warning.message))).toBe(false);
    expect(existsSync(`${file}.refreshed`)).toBe(false);
    expect(officecliVerbs(file)).not.toContain('refresh');
    expect(result.warnings.some(warning => /style='TOC/i.test(warning.message))).toBe(false);
  });

  it('does not treat leftover TOC entries as compiled when Word COM is unavailable', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-toc-stale');
    const file = document(w, 'has-toc-compiled.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' }));
    const refreshCheck = result.evidence?.checks.find(check => check.name === 'docx_field_refresh');

    expect(result.deliveryReady).toBe(true);
    expect(refreshCheck).toMatchObject({
      ok: false,
      data: { status: 'deferred', action: 'defer_to_word', compiled: false },
    });
    expect(existsSync(`${file}.refreshed`)).toBe(false);
    expect(officecliVerbs(file)).not.toContain('refresh');
    expect(result.warnings.some(warning => /style='TOC/i.test(warning.message))).toBe(false);
  });

  it('uses native Word refresh only when that backend is available', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-toc-native');
    const file = document(w, 'has-toc.docx');
    const compiled = await compileDocxTocIfPresent(ctx, file, TEST_DEPENDENCIES, {
      nativeRefreshAvailable: true,
    });

    expect(compiled.check).toMatchObject({
      ok: true,
      data: { action: 'native_refresh', status: 'compiled', backend: 'word', compiled: true },
    });
    expect(existsSync(`${file}.refreshed`)).toBe(true);
    expect(officecliVerbs(file)).toContain('refresh');
    expect(officecliVerbs(file)).toContain('query');
    expect(officecliVerbs(file)).toContain('set');
  });

  it('falls back to updateFields when native Word refresh fails without blocking delivery', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-toc-fail');
    const file = document(w, 'has-toc-refresh-fail.docx');
    const compiled = await compileDocxTocIfPresent(ctx, file, TEST_DEPENDENCIES, {
      nativeRefreshAvailable: true,
    });

    expect(compiled.check).toMatchObject({
      ok: false,
      blocking: false,
      data: { status: 'refresh_failed', updateFields: true, fallback: true },
    });
    expect(compiled.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'docx_toc_uncompiled', severity: 'high' }),
    ]));
    expect(JSON.stringify(compiled.warnings)).not.toMatch(/Windows only/i);
  });

  it('does not refresh a TOC that has no heading sources', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-toc-empty');
    const file = document(w, 'has-toc-no-headings.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' }));
    const refreshCheck = result.evidence?.checks.find(check => check.name === 'docx_field_refresh');

    expect(result.deliveryReady).toBe(true);
    expect(refreshCheck).toMatchObject({
      ok: false,
      blocking: false,
      data: { compiled: false, status: 'empty', action: 'no_sources', fallback: true, updateFields: true, entryMatches: 0 },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'docx_toc_empty', severity: 'high' }),
    ]));
    expect(existsSync(`${file}.refreshed`)).toBe(false);
    expect(officecliVerbs(file)).not.toContain('refresh');
  });

  it('lets Word COM decide emptiness instead of skipping refresh from a heading query', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-toc-native-empty');
    const file = document(w, 'has-toc-no-headings.docx');
    const compiled = await compileDocxTocIfPresent(ctx, file, TEST_DEPENDENCIES, {
      nativeRefreshAvailable: true,
    });

    expect(compiled.check).toMatchObject({
      ok: false,
      data: { action: 'native_refresh', status: 'empty', compiled: false },
    });
    expect(officecliVerbs(file)).toContain('refresh');
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

  it('rejects placeholder leaks at the skill Delivery Gate', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-leak');
    const file = document(w, 'leak.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
    const leak = result.evidence?.checks.find(check => check.name === 'skill_placeholder_leak');

    expect(result.deliveryReady).toBe(false);
    expect(leak).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'docx_placeholder_leak' },
    });
    expect(result.error?.recovery).toContain('Delivery Gate');
    expect(result.error?.recovery).toContain('{var}');
  });

  it('rejects official brace-form placeholder leaks', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-brace-var');
    const file = document(w, 'brace-var.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result.deliveryReady).toBe(false);
    expect(result.evidence?.checks.find(check => check.name === 'skill_placeholder_leak')).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'docx_placeholder_leak' },
    });
  });

  it('requires a PAGE field when a Word document has three heading sources', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-page-gate');
    const file = document(w, 'has-three-headings-has-toc.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
    const page = result.evidence?.checks.find(check => check.name === 'skill_page_field');

    expect(result.deliveryReady).toBe(false);
    expect(page).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'docx_page_field_required' },
    });
    expect(result.error?.recovery).toContain('field=page');
    expect(officecliVerbs(file)).toContain('query');
    expect(officecliVerbs(file)).toContain('screenshot-grid');
  });

  it('warns but does not block when a Word document has three heading sources and no TOC', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-toc-gate');
    const file = document(w, 'has-three-headings-has-page.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
    const toc = result.evidence?.checks.find(check => check.name === 'skill_toc_field');

    expect(result.deliveryReady).toBe(true);
    expect(toc).toMatchObject({
      ok: false,
      blocking: false,
      data: expect.objectContaining({ detected: false, officialGate: 'not_required' }),
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'docx_toc_recommended', severity: 'high' }),
    ]));
  });

  it('passes skill TOC and PAGE gates when both fields exist', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-skill-ready');
    const file = document(w, 'has-three-headings-has-toc-has-page.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result.deliveryReady).toBe(true);
    expect(result.evidence?.checks.find(check => check.name === 'skill_toc_field')).toMatchObject({ ok: true });
    expect(result.evidence?.checks.find(check => check.name === 'skill_page_field')).toMatchObject({ ok: true });
    expect(result.evidence?.checks.find(check => check.name === 'final_render')).toMatchObject({
      blocking: false,
    });
  });

  it('treats heading-less Normal-only Word reports as a skill heading miss', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-normal-only');
    const file = document(w, 'normal-only.docx');
    const strict = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
    const standard = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' }));

    expect(strict.deliveryReady).toBe(false);
    expect(strict.evidence?.checks.find(check => check.name === 'skill_heading_sources')).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'docx_heading_hierarchy_missing' },
    });
    expect(standard.deliveryReady).toBe(true);
    expect(standard.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'docx_heading_hierarchy_missing', severity: 'high' }),
    ]));
  });

  it('does not block delivery when the screenshot fails', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-screenshot-fail');
    const file = document(w, 'all-renderers-fail.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result.deliveryReady).toBe(true);
    expect(result.evidence?.checks.find(check => check.name === 'final_render')).toMatchObject({
      ok: false,
      blocking: false,
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'visual_not_verified' }),
    ]));
  });

  it('reuses a same-revision preview instead of taking a second screenshot', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-reuse-preview');
    const file = document(w, 'reuse-preview.docx');
    await handleOfficeDocumentPreview(ctx, { action: 'render', file, page: '1', renderer: 'html' });
    const before = officecliVerbs(file).filter(verb => verb.startsWith('screenshot')).length;
    const raw = await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' });
    const result = envelope(raw);
    const after = officecliVerbs(file).filter(verb => verb.startsWith('screenshot'));

    expect(result.deliveryReady).toBe(true);
    expect(before).toBe(1);
    expect(after).toEqual(['screenshot']);
    expect(result.evidence?.checks.find(check => check.name === 'final_render')?.data).toEqual(
      expect.objectContaining({ reusedPreview: true }),
    );
    expect(raw.content.some(block => block.type === 'image')).toBe(false);
    expect(raw.content[0]?.text).toContain('```image-preview');
  });

  it('filters word first-line-indent false positives out of the issue gate', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-indent-fp');
    const file = document(w, 'indent-false-positive.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
    const issues = result.evidence?.checks.find(check => check.name === 'format_structure_content_issues');

    expect(result.deliveryReady).toBe(true);
    expect(issues).toMatchObject({ ok: true, data: { count: 0 } });
  });

  it('blocks undersized Heading1 when the official visual floor can be read', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-small-heading');
    const file = document(w, 'small-heading.docx');
    const strict = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));
    const standard = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'standard' }));

    expect(strict.deliveryReady).toBe(false);
    expect(strict.evidence?.checks.find(check => check.name === 'skill_heading_size')).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'docx_heading_size_below_floor' },
    });
    expect(standard.deliveryReady).toBe(true);
    expect(standard.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'docx_heading_size_below_floor', severity: 'high' }),
    ]));
  });

  it('requires a PAGE field on long Word documents even with fewer than three headings', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-long-page');
    const file = document(w, 'two-heading-long.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result.deliveryReady).toBe(false);
    expect(result.evidence?.checks.find(check => check.name === 'skill_page_field')).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'docx_page_field_required' },
    });
    expect(result.evidence?.checks.find(check => check.name === 'skill_toc_field')).toBeUndefined();
  });

  it('skips Excel error-cell queries when the outline has no formulas', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-values-only');
    const file = document(w, 'values-only.xlsx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result.deliveryReady).toBe(true);
    expect(result.evidence?.checks.find(check => check.name === 'skill_excel_errors')).toMatchObject({
      ok: true,
      data: { skipped: 'no_formulas' },
    });
    expect(officecliVerbs(file)).not.toContain('query');
  });

  it('blocks Excel workbooks that still contain formula error cells', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-excel-error');
    const file = document(w, 'excel-error.xlsx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result.deliveryReady).toBe(false);
    expect(result.evidence?.checks.find(check => check.name === 'skill_excel_errors')).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'xlsx_formula_error_cells' },
    });
  });

  it('takes one HTML screenshot during finalize when native rendering is unavailable', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-one-shot');
    const file = document(w, 'plain-report.docx');
    const result = envelope(await handleOfficeDocumentFinalizeImpl(ctx, { file, profile: 'standard' }, {
      ...TEST_DEPENDENCIES,
      nativeScreenshotAvailable: false,
    }));

    expect(result.deliveryReady).toBe(true);
    expect(officecliVerbs(file).filter(verb => verb.startsWith('screenshot'))).toEqual(['screenshot']);
  });

  it('rejects academic citation and SEQ mismatches', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-academic');
    const file = document(w, 'academic-cite.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result.deliveryReady).toBe(false);
    expect(result.evidence?.checks.find(check => check.name === 'skill_academic_citations')).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'academic_citation_roundtrip' },
    });
    expect(result.evidence?.checks.find(check => check.name === 'skill_academic_seq')).toMatchObject({
      ok: false,
      blocking: true,
      error: { code: 'academic_seq_mismatch' },
    });
  });

  it('rejects word-form identity, protection, and fill-in leaks', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-form');
    const file = document(w, 'form-sdt.docx');
    const result = envelope(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }));

    expect(result.deliveryReady).toBe(false);
    expect(result.evidence?.checks.find(check => check.name === 'skill_form_identity')).toMatchObject({
      ok: false,
      error: { code: 'word_form_sdt_identity' },
    });
    expect(result.evidence?.checks.find(check => check.name === 'skill_form_protection')).toMatchObject({
      ok: false,
      error: { code: 'word_form_protection' },
    });
    expect(result.evidence?.checks.find(check => check.name === 'skill_form_placeholder_leak')).toMatchObject({
      ok: false,
      error: { code: 'word_form_placeholder_leak' },
    });
  });

  it('rejects financial imbalance cells and clipped ### values', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-financial');
    const imbalanced = envelope(await handleOfficeDocumentFinalize(ctx, {
      file: document(w, 'imbalanced.xlsx'),
      profile: 'strict',
    }));
    const clipped = envelope(await handleOfficeDocumentFinalize(ctx, {
      file: document(w, 'hash-clip.xlsx'),
      profile: 'strict',
    }));

    expect(imbalanced.deliveryReady).toBe(false);
    expect(imbalanced.evidence?.checks.find(check => check.name === 'skill_financial_integrity')).toMatchObject({
      ok: false,
      error: { code: 'xlsx_financial_imbalance' },
    });
    expect(clipped.deliveryReady).toBe(false);
    expect(clipped.evidence?.checks.find(check => check.name === 'skill_excel_clipped_hash')).toMatchObject({
      ok: false,
      error: { code: 'xlsx_clipped_hash' },
    });
  });

  it('rejects pitch $ strip signatures and morph price leaks', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-pitch-morph');
    const pitchFile = document(w, 'pitch-strip.pptx');
    const morphFile = document(w, 'morph-price.pptx');
    const pitch = envelope(await handleOfficeDocumentFinalize(ctx, { file: pitchFile, profile: 'strict' }));
    const morph = envelope(await handleOfficeDocumentFinalize(ctx, { file: morphFile, profile: 'strict' }));

    expect(pitch.deliveryReady).toBe(false);
    expect(pitch.evidence?.checks.find(check => check.name === 'skill_pitch_strip')).toMatchObject({
      ok: false,
      error: { code: 'pptx_pitch_dollar_strip' },
    });
    expect(morph.deliveryReady).toBe(false);
    expect(morph.evidence?.checks.find(check => check.name === 'skill_morph_price_leak')).toMatchObject({
      ok: false,
      error: { code: 'pptx_morph_price_leak' },
    });
    expect(officecliVerbs(pitchFile)).toContain('screenshot-grid');
  });

  it('rejects leftover empty () / [] on PowerPoint and dashboard executable floors', async () => {
    const w = workspace();
    const ctx = context(w, 'finalize-remaining-gates');
    const emptyParens = envelope(await handleOfficeDocumentFinalize(ctx, {
      file: document(w, 'empty-parens.pptx'),
      profile: 'strict',
    }));
    const dashboard = envelope(await handleOfficeDocumentFinalize(ctx, {
      file: document(w, 'dashboard.xlsx'),
      profile: 'strict',
    }));

    expect(emptyParens.deliveryReady).toBe(false);
    expect(emptyParens.evidence?.checks.find(check => check.name === 'skill_pptx_empty_placeholder')).toMatchObject({
      ok: false,
      error: { code: 'pptx_empty_placeholder' },
    });
    expect(dashboard.deliveryReady).toBe(false);
    expect(dashboard.evidence?.checks.find(check => check.name === 'skill_dashboard_series_names')).toMatchObject({
      ok: false,
      error: { code: 'xlsx_dashboard_series1' },
    });
    expect(dashboard.evidence?.checks.find(check => check.name === 'skill_dashboard_workbook')).toMatchObject({
      ok: false,
      error: { code: 'xlsx_dashboard_workbook' },
    });
  });
});
