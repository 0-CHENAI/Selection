import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { ensureDocxOutlineHeadingStyles } from '@craft-agent/shared/utils';
import { handleOfficecliBatch } from './officecli-batch.ts';
import { handleOfficecliFinalize } from './officecli-finalize.ts';
import { handleOfficecliQa } from './officecli-qa.ts';
import { inspectOfficecliAttribution } from './officecli-metadata.ts';
import { runOfficecli } from '../runtime/officecli-runtime.ts';

const enabled = process.env.OFFICECLI_INTEGRATION === '1';
const appRoot = process.env.CRAFT_RESOURCES_BASE ?? resolve(import.meta.dir, '../../../..');
const resourcesBin = process.env.CRAFT_RESOURCES_BASE
  ? join(process.env.CRAFT_RESOURCES_BASE, 'resources', 'bin')
  : join(appRoot, 'apps', 'electron', 'resources', 'bin');
const platformKey = `${process.platform}-${process.arch}`;
const binaryName = process.platform === 'win32' ? 'officecli.exe' : 'officecli';
const binary = process.env.CRAFT_OFFICECLI
  ?? join(resourcesBin, platformKey, binaryName)
  ?? '';
const wrapper = join(resourcesBin, process.platform === 'win32' ? 'officecli.cmd' : 'officecli');
const wrapperScript = join(resourcesBin, '..', 'scripts', 'officecli-wrapper.js');
const bundledBun = join(resourcesBin, '..', '..', 'vendor', 'bun', process.platform === 'win32' ? 'bun.exe' : 'bun');

function runWrapper(args: string[], options: { cwd: string; stdin?: string }) {
  if (process.platform !== 'win32') return runOfficecli(wrapper, args, options);
  // The .cmd shim only locates the reviewed Bun script and app binary. Invoke
  // those exact packaged targets directly so the integration test does not add
  // another shell-quoting layer around Unicode/space-containing paths.
  return runOfficecli(bundledBun, [wrapperScript, binary, ...args], options);
}

describe.skipIf(!enabled)('OfficeCLI typed tools integration', () => {
  let root = '';
  let file = '';
  let context: SessionToolContext;

  beforeAll(async () => {
    if (!binary || !existsSync(binary)) throw new Error(`OfficeCLI runtime is missing: ${binary || 'unresolved'}`);
    root = mkdtempSync(join(tmpdir(), 'selection-officecli-typed-integration-'));
    const workingDirectory = join(root, '含 空格的目录');
    mkdirSync(workingDirectory, { recursive: true });
    file = join(workingDirectory, '批处理 ; $(touch OFFICECLI_SHELL_INJECTION).docx');
    const created = await runOfficecli(binary, ['create', file, '--json'], { cwd: workingDirectory });
    if (created.exitCode !== 0) throw new Error(created.stderr || created.stdout);
    if (existsSync(join(workingDirectory, 'OFFICECLI_SHELL_INJECTION'))) {
      throw new Error('OfficeCLI path was interpreted by a shell');
    }

    context = {
      sessionId: 'officecli-integration',
      workspacePath: workingDirectory,
      get sourcesPath() { return join(workingDirectory, 'sources'); },
      get skillsPath() { return join(workingDirectory, 'skills'); },
      plansFolderPath: join(workingDirectory, 'plans'),
      sessionPath: workingDirectory,
      dataPath: join(workingDirectory, 'data'),
      workingDirectory,
      callbacks: { onPlanSubmitted() {}, onAuthRequest() {} },
      fs: {} as SessionToolContext['fs'],
      loadSourceConfig: () => null,
      officecli: {
        binaryPath: binary,
        ensureDocxOutlineStyles: (target: string) => ensureDocxOutlineHeadingStyles(target, {
          cwd: appRoot,
          appRootPath: appRoot,
          resourcesPath: process.env.CRAFT_RESOURCES_BASE,
          trustEnvironment: false,
          binary,
        }),
      },
    };
  });

  afterAll(async () => {
    if (file && context) {
      await runOfficecli(binary, ['close', file, '--json'], { cwd: context.workingDirectory! });
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('writes 100 ordered paragraphs in two atomic batches', async () => {
    const operations = Array.from({ length: 100 }, (_, index) => ({
      command: 'add' as const,
      parent: '/body',
      type: 'paragraph',
      props: { text: `paragraph-${String(index).padStart(3, '0')}` },
    }));

    const first = await handleOfficecliBatch(context, { file, operations: operations.slice(0, 50) });
    const second = await handleOfficecliBatch(context, { file, operations: operations.slice(50) });
    expect(first.structuredContent).toMatchObject({ success: true, operationCount: 50, appliedCount: 50 });
    expect(second.structuredContent).toMatchObject({ success: true, operationCount: 50, appliedCount: 50 });
    expect(existsSync(join(context.workingDirectory!, 'OFFICECLI_SHELL_INJECTION'))).toBe(false);

    const view = await runOfficecli(binary, ['view', file, 'text'], { cwd: context.workingDirectory! });
    expect(view.exitCode).toBe(0);
    expect(view.stdout.indexOf('paragraph-000')).toBeLessThan(view.stdout.indexOf('paragraph-099'));
  }, 30_000);

  it('uses the same typed batch handler for XLSX and PPTX files', async () => {
    const xlsx = join(context.workingDirectory!, '类型化 数据.xlsx');
    const pptx = join(context.workingDirectory!, '类型化 汇报.pptx');
    for (const target of [xlsx, pptx]) {
      const created = await runOfficecli(binary, ['create', target, '--json'], {
        cwd: context.workingDirectory!,
      });
      expect(created.exitCode).toBe(0);
    }

    const sheet = await handleOfficecliBatch(context, {
      file: xlsx,
      operations: [
        { command: 'set', path: '/Sheet1/A1', props: { value: '姓名', bold: true } },
        { command: 'set', path: '/Sheet1/A2', props: { value: '张三' } },
      ],
    });
    const deck = await handleOfficecliBatch(context, {
      file: pptx,
      operations: [
        { command: 'add', parent: '/', type: 'slide', props: { title: '巡察汇报' } },
      ],
    });
    expect(sheet.structuredContent).toMatchObject({ success: true, appliedCount: 2 });
    expect(deck.structuredContent).toMatchObject({ success: true, appliedCount: 1 });

    const sheetText = await runOfficecli(binary, ['view', xlsx, 'text'], { cwd: context.workingDirectory! });
    const deckText = await runOfficecli(binary, ['view', pptx, 'text'], { cwd: context.workingDirectory! });
    expect(sheetText.stdout).toMatch(/姓名|张三/);
    expect(deckText.stdout).toContain('巡察汇报');

    await runOfficecli(binary, ['close', xlsx, '--json'], { cwd: context.workingDirectory! });
    await runOfficecli(binary, ['close', pptx, '--json'], { cwd: context.workingDirectory! });
  }, 30_000);

  it('rolls back the whole batch when one operation fails', async () => {
    const result = await handleOfficecliBatch(context, {
      file,
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: 'ROLLBACK_SENTINEL' } },
        { command: 'set', path: '/does-not-exist', props: { text: 'fail' } },
      ],
    });
    expect(result.structuredContent).toMatchObject({
      success: false,
      appliedCount: 0,
      rolledBack: true,
      failedIndex: 1,
    });

    const view = await runOfficecli(binary, ['view', file, 'text'], { cwd: context.workingDirectory! });
    expect(view.stdout).not.toContain('ROLLBACK_SENTINEL');
  }, 30_000);

  it('restores real DOCX style-preflight changes when the dependent batch rolls back', async () => {
    const preflightFile = join(context.workingDirectory!, 'heading preflight rollback.docx');
    const created = await runOfficecli(binary, ['create', preflightFile, '--json'], {
      cwd: context.workingDirectory!,
    });
    expect(created.exitCode).toBe(0);
    const before = readFileSync(preflightFile);

    const result = await handleOfficecliBatch(context, {
      file: preflightFile,
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: 'ROLLBACK_HEADING', style: 'Heading1' } },
        { command: 'set', path: '/does-not-exist', props: { text: 'fail' } },
      ],
    });
    expect(result.structuredContent).toMatchObject({
      success: false,
      appliedCount: 0,
      rolledBack: true,
      commitStatus: 'rolled_back',
    });
    expect(readFileSync(preflightFile).equals(before)).toBe(true);

    await runOfficecli(binary, ['close', preflightFile, '--json'], {
      cwd: context.workingDirectory!,
    });
  }, 30_000);

  it('preserves an earlier TOC when a later dependent batch rolls back and work resumes', async () => {
    const target = join(context.workingDirectory!, 'toc survives later rollback.docx');
    const created = await runOfficecli(binary, ['create', target, '--json'], {
      cwd: context.workingDirectory!,
    });
    expect(created.exitCode).toBe(0);

    const initial = await handleOfficecliBatch(context, {
      file: target,
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: '第一章', style: 'Heading1' } },
        { command: 'add', parent: '/body', type: 'toc', props: { levels: '1-3', title: '目录', hyperlinks: true } },
      ],
    });
    expect(initial.structuredContent).toMatchObject({ success: true });

    const rejected = await handleOfficecliBatch(context, {
      file: target,
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: '第二章', style: 'Heading1' } },
        { command: 'set', path: '/does-not-exist', props: { text: 'fail' } },
      ],
    });
    expect(rejected.structuredContent).toMatchObject({ success: false, rolledBack: true });

    const resumed = await handleOfficecliBatch(context, {
      file: target,
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: '恢复后的正文' } },
      ],
    });
    expect(resumed.structuredContent).toMatchObject({ success: true });

    const toc = await runOfficecli(binary, ['query', target, 'toc', '--json'], {
      cwd: context.workingDirectory!,
    });
    expect(toc.exitCode).toBe(0);
    expect(JSON.parse(toc.stdout).data.matches).toBeGreaterThan(0);
    await runOfficecli(binary, ['close', target, '--json'], { cwd: context.workingDirectory! });
  }, 30_000);

  it('passes structural QA with Heading1–3, TOC, and a live PAGE field', async () => {
    const setup = await handleOfficecliBatch(context, {
      file,
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: '一级标题', style: 'Heading1' } },
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: '二级标题', style: 'Heading2' } },
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: '三级标题', style: 'Heading3' } },
        { command: 'add', parent: '/body', type: 'toc', props: { levels: '1-3', title: '目录', hyperlinks: true } },
        { command: 'add', parent: '/', type: 'footer', props: { type: 'default', text: 'Page ', align: 'center' } },
        { command: 'add', parent: '/footer[1]/p[1]', type: 'field', props: { fieldType: 'page' } },
      ],
    });
    expect(setup.isError).toBe(false);
    expect(inspectOfficecliAttribution(file)).toEqual({ clean: true, entries: [] });

    const qa = await handleOfficecliQa({ ...context, supportsImages: false }, { file, mode: 'balanced' });
    expect(qa.structuredContent).toMatchObject({
      structuralStatus: 'passed',
      visualStatus: 'skipped_no_vision',
      requiresHumanVisualReview: true,
    });
    expect(qa.content).toHaveLength(1);
  }, 30_000);

  it('returns one real contact-sheet image for the same fixture when vision is supported', async () => {
    const qa = await handleOfficecliQa({ ...context, supportsImages: true }, { file, mode: 'balanced' });
    expect(qa.structuredContent).toMatchObject({
      structuralStatus: 'passed',
      visualStatus: 'checked',
      requiresHumanVisualReview: false,
    });
    expect(qa.content).toHaveLength(2);
    expect(qa.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  }, 90_000);

  it('preserves explicitly requested visible attribution through trusted typed finalization', async () => {
    const explicitFile = join(context.workingDirectory!, 'explicit attribution.docx');
    const created = await runOfficecli(binary, ['create', explicitFile, '--json'], {
      cwd: context.workingDirectory!,
    });
    expect(created.exitCode).toBe(0);

    const batch = await handleOfficecliBatch({
      ...context,
      officecliAttributionPolicy: 'allow-visible',
    }, {
      file: explicitFile,
      operations: [{
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: '本文档由 OfficeCLI 自动生成' },
      }],
    });
    expect(batch.structuredContent).toMatchObject({ success: true });

    const finalized = await handleOfficecliFinalize({
      ...context,
      officecliAttributionPolicy: 'allow-visible',
    }, { file: explicitFile });
    expect(finalized.structuredContent).toMatchObject({
      success: true,
      saved: true,
      closed: true,
      attributionClean: true,
      visibleBadgesRemoved: 0,
    });
    expect(inspectOfficecliAttribution(explicitFile, { allowVisibleAttribution: true }))
      .toEqual({ clean: true, entries: [] });
    expect(inspectOfficecliAttribution(explicitFile).clean).toBe(false);
  }, 30_000);

  it('keeps the single Shell batch fallback attribution-free', async () => {
    const fallbackFile = join(context.workingDirectory!, 'flag-off 批处理.docx');
    const created = await runWrapper(['create', fallbackFile, '--json'], {
      cwd: context.workingDirectory!,
    });
    expect(created.exitCode).toBe(0);

    const batch = await runWrapper(['batch', fallbackFile, '--stop-on-error', '--json'], {
      cwd: context.workingDirectory!,
      stdin: JSON.stringify([
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: 'fallback-body' } },
      ]),
    });
    expect(batch.exitCode).toBe(0);
    expect(inspectOfficecliAttribution(fallbackFile)).toEqual({ clean: true, entries: [] });

    const saved = await runWrapper(['save', fallbackFile, '--json'], {
      cwd: context.workingDirectory!,
    });
    const closed = await runWrapper(['close', fallbackFile, '--json'], {
      cwd: context.workingDirectory!,
    });
    expect(saved.exitCode).toBe(0);
    expect(closed.exitCode).toBe(0);
    expect(inspectOfficecliAttribution(fallbackFile)).toEqual({ clean: true, entries: [] });
  }, 30_000);

  it('removes unrequested visible generator stamps on the flag-off Shell path', async () => {
    const fallbackFile = join(context.workingDirectory!, 'flag-off visible attribution.docx');
    const created = await runWrapper(['create', fallbackFile, '--json'], {
      cwd: context.workingDirectory!,
    });
    expect(created.exitCode).toBe(0);

    const stamped = await runWrapper(['batch', fallbackFile, '--stop-on-error', '--json'], {
      cwd: context.workingDirectory!,
      stdin: JSON.stringify([
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: '本文档由 OfficeCLI 自动生成' } },
      ]),
    });
    expect(stamped.exitCode).toBe(0);
    expect(inspectOfficecliAttribution(fallbackFile)).toEqual({ clean: true, entries: [] });
    const saved = await runWrapper(['save', fallbackFile, '--json'], {
      cwd: context.workingDirectory!,
    });
    expect(saved.exitCode).toBe(0);
    expect(inspectOfficecliAttribution(fallbackFile)).toEqual({ clean: true, entries: [] });
    const closed = await runWrapper(['close', fallbackFile, '--json'], { cwd: context.workingDirectory! });
    expect(closed.exitCode).toBe(0);
  }, 30_000);
});
