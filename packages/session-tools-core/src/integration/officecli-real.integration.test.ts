import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import { handleOfficeDocumentEdit, handleOfficeDocumentInspect } from '../handlers/office-document.ts';
import { handleOfficeDocumentFinalize } from '../handlers/office-finalize.ts';
import {
  clearOfficePreviewState,
  handleOfficeDocumentPreview,
  releaseOfficePreviewSession,
} from '../handlers/office-preview.ts';
import type { OfficeResultEnvelope } from '../office-types.ts';
import { clearOfficeRuntimeState, releaseOfficeRuntimeSession } from '../runtime/office-coordinator.ts';
import { buildMorphCloneCommands } from '../runtime/office-recipes.ts';
import type { ToolResult } from '../types.ts';

const runIntegration = process.env.OFFICECLI_INTEGRATION === '1';
const integrationIt = runIntegration ? it : it.skip;

let root = '';
let working = '';
let ctx: SessionToolContext;
let openedWatchUrl: string | undefined;

function envelope(result: ToolResult): OfficeResultEnvelope {
  return result.structuredContent as OfficeResultEnvelope;
}

function requireSuccess(result: ToolResult, label: string): OfficeResultEnvelope {
  const value = envelope(result);
  expect(value.ok, `${label}: ${JSON.stringify({
    error: value.error,
    warnings: value.warnings,
    checks: value.evidence?.checks?.map(check => ({
      name: check.name,
      ok: check.ok,
      blocking: check.blocking,
      error: check.error,
    })),
  })}`).toBe(true);
  return value;
}

function batchCommand(command: Record<string, unknown>): string {
  return JSON.stringify(command);
}

beforeAll(() => {
  if (!runIntegration) return;
  root = mkdtempSync(join(tmpdir(), 'selection-officecli-real-'));
  const workspace = join(root, 'workspace');
  const sessionPath = join(workspace, 'sessions', 'officecli-integration');
  working = join(workspace, '项目 工作区');
  mkdirSync(join(sessionPath, 'data'), { recursive: true });
  mkdirSync(working, { recursive: true });
  ctx = {
    sessionId: 'officecli-integration',
    workspacePath: workspace,
    sessionPath,
    dataPath: join(sessionPath, 'data'),
    workingDirectory: working,
    get sourcesPath() { return join(workspace, 'sources'); },
    get skillsPath() { return join(workspace, 'skills'); },
    plansFolderPath: join(sessionPath, 'plans'),
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: createNodeFileSystem(),
    loadSourceConfig: () => null,
    openOfficePreview: async (url) => {
      openedWatchUrl = url;
      return { url, instanceId: 'officecli-integration-browser' };
    },
  };
  clearOfficeRuntimeState();
  clearOfficePreviewState();
});

afterAll(async () => {
  if (!runIntegration) return;
  try {
    releaseOfficePreviewSession(ctx.sessionId);
    await releaseOfficeRuntimeSession(ctx.sessionId);
  } finally {
    clearOfficePreviewState();
    clearOfficeRuntimeState();
    rmSync(root, { recursive: true, force: true });
  }
});

describe('real OfficeCLI 1.0.144 integration', () => {
  integrationIt('creates files in existing, missing, spaced, and non-ASCII directories (#60)', async () => {
    const outputs = [
      '已存在/report.docx',
      '新建/多层/report.docx',
      'folder with spaces/report.docx',
      '中文 目录/季度 报告.docx',
    ];
    mkdirSync(join(working, '已存在'), { recursive: true });

    for (const output of outputs) {
      const result = await handleOfficeDocumentEdit(ctx, { argv: ['create', output] });
      const payload = requireSuccess(result, `create ${output}`);
      expect(payload.command).toContain(output);
      expect(existsSync(join(working, output))).toBe(true);
    }

    const typedOutput = '中文 目录/无扩展名输出';
    const typed = requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['create', typedOutput, '--type', 'docx'],
    }), `create ${typedOutput} --type docx`);
    expect(typed.command).toContain(`${typedOutput}.docx`);
    expect(typed.documentPath).toBe(join(realpathSync.native(working), `${typedOutput}.docx`));
    expect(existsSync(join(working, `${typedOutput}.docx`))).toBe(true);
  }, 120_000);

  integrationIt('runs DOCX create → atomic batch → inspect → render → strict finalize', async () => {
    const file = '中文 目录/完整 Word 文档.docx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', file] }), 'create docx');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['batch', file],
      batch: {
        commands: [
          batchCommand({ command: 'add', parent: '/body', type: 'paragraph', props: { text: '季度经营报告', style: 'Heading1', bold: 'true', size: '20pt' } }),
          batchCommand({ command: 'add', parent: '/body', type: 'toc', index: 0, props: { levels: '1-3', title: '目录', hyperlinks: 'true' } }),
          batchCommand({ command: 'add', parent: '/body', type: 'paragraph', props: { text: '执行摘要', style: 'Heading1' } }),
          batchCommand({ command: 'add', parent: '/body', type: 'paragraph', props: { text: '收入同比增长 18%，路径中的空格与中文保持完整。', style: 'Normal' } }),
          batchCommand({ command: 'add', parent: '/body', type: 'table', props: { rows: '2', cols: '3', width: '100%' } }),
          batchCommand({ command: 'set', path: '/body/tbl[1]/tr[1]', props: { header: 'true', c1: '季度', c2: '收入', c3: '增长' } }),
          batchCommand({ command: 'set', path: '/body/tbl[1]/tr[2]', props: { c1: 'Q4', c2: '180', c3: '18%' } }),
        ],
      },
    }), 'batch docx');
    requireSuccess(await handleOfficeDocumentInspect(ctx, { argv: ['view', file, 'outline'] }), 'inspect docx outline');
    requireSuccess(await handleOfficeDocumentInspect(ctx, { argv: ['validate', file] }), 'validate docx');
    const preview = requireSuccess(await handleOfficeDocumentPreview(ctx, {
      action: 'render', file, grid: 'auto', renderer: 'html',
    }), 'render docx');
    expect(preview.artifacts.some(artifact => artifact.kind === 'image')).toBe(true);
    const finalized = requireSuccess(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }), 'finalize docx');
    expect(finalized.deliveryReady).toBe(true);
    expect(finalized.evidence?.artifactRevision).toBe(finalized.artifactRevision);
  }, 180_000);

  integrationIt('runs native merge, atomic import recovery, and the real refresh capability', async () => {
    const template = '能力覆盖/问候模板.docx';
    const merged = '能力覆盖/问候 Selection.docx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', template] }), 'create merge template');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['add', template, '/body', '--type', 'paragraph', '--prop', 'text=您好，{{name}}！'],
    }), 'add merge placeholder');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['merge', template, merged, '--data', '{"name":"Selection"}'],
    }), 'merge docx template');
    const mergedText = requireSuccess(
      await handleOfficeDocumentInspect(ctx, { argv: ['view', merged, 'text'] }),
      'inspect merged docx',
    );
    expect(JSON.stringify(mergedText.data)).toContain('Selection');

    const workbook = '能力覆盖/导入数据.xlsx';
    const csv = join(working, '能力覆盖', '季度 数据.csv');
    writeFileSync(csv, '季度,收入\nQ1,42000\nQ2,45000\n');
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', workbook] }), 'create import workbook');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['import', workbook, '/Sheet1', csv, '--header'],
    }), 'import csv');
    const imported = requireSuccess(
      await handleOfficeDocumentInspect(ctx, { argv: ['get', workbook, '/Sheet1/B3'] }),
      'inspect imported cell',
    );
    expect(JSON.stringify(imported.data)).toContain('45000');

    const refresh = envelope(await handleOfficeDocumentEdit(ctx, { argv: ['refresh', merged] }));
    if (refresh.ok) {
      expect(refresh.backend || JSON.stringify(refresh.data)).toBeTruthy();
    } else {
      expect(refresh.error).toBeDefined();
      expect(['dependency', 'runtime']).toContain(refresh.error!.category);
      expect(refresh.error?.message).toBeTruthy();
      expect(refresh.error?.upstreamCode || refresh.stderr || refresh.warnings.length).toBeTruthy();
    }
  }, 180_000);

  integrationIt('runs XLSX and PPTX native create/edit/inspect/render/finalize flows', async () => {
    const xlsx = '新建/多层/财务 模型.xlsx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', xlsx] }), 'create xlsx');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['batch', xlsx],
      batch: { commands: [
        batchCommand({ command: 'add', parent: '/', type: 'sheet', props: { name: 'Assumptions', tabColor: 'FFC000' } }),
        batchCommand({ command: 'add', parent: '/', type: 'sheet', props: { name: 'Summary', tabColor: '70AD47' } }),
        batchCommand({ command: 'set', path: '/Sheet1/A1', props: { value: '月份', bold: 'true' } }),
        batchCommand({ command: 'set', path: '/Sheet1/B1', props: { value: '收入', bold: 'true' } }),
        batchCommand({ command: 'set', path: '/Sheet1/A2', props: { value: '一月' } }),
        batchCommand({ command: 'set', path: '/Sheet1/B2', props: { value: '42000', numFmt: '¥#,##0' } }),
        batchCommand({ command: 'set', path: '/Sheet1/A3', props: { value: '二月' } }),
        batchCommand({ command: 'set', path: '/Sheet1/B3', props: { value: '45000', numFmt: '¥#,##0' } }),
        batchCommand({ command: 'set', path: '/Sheet1/A4', props: { value: '合计', bold: 'true' } }),
        batchCommand({ command: 'set', path: '/Sheet1/B4', props: { formula: 'SUM(B2:B3)', bold: 'true', numFmt: '¥#,##0' } }),
        batchCommand({ command: 'set', path: '/Assumptions/A1', props: { value: '增长假设', bold: 'true' } }),
        batchCommand({ command: 'set', path: '/Assumptions/B2', props: { value: '0.12', numFmt: '0.0%', fill: 'FFFF00', 'font.color': '0000FF' } }),
        batchCommand({ command: 'set', path: '/Summary/A1', props: { value: '下月收入', bold: 'true' } }),
        batchCommand({ command: 'set', path: '/Summary/B1', props: { formula: "Sheet1!B4*(1+Assumptions!B2)", numFmt: '¥#,##0', 'font.color': '008000' } }),
      ] },
    }), 'batch xlsx');
    requireSuccess(await handleOfficeDocumentInspect(ctx, { argv: ['get', xlsx, '/Sheet1/B4'] }), 'inspect xlsx formula');
    const crossSheet = requireSuccess(
      await handleOfficeDocumentInspect(ctx, { argv: ['get', xlsx, '/Summary/B1'] }),
      'inspect cross-sheet formula',
    );
    expect(JSON.stringify(crossSheet.data)).toContain('Sheet1!B4');
    expect(JSON.stringify(crossSheet.data)).not.toContain('\\\\!');
    requireSuccess(await handleOfficeDocumentPreview(ctx, { action: 'render', file: xlsx, page: '1', renderer: 'html' }), 'render xlsx');
    expect(requireSuccess(await handleOfficeDocumentFinalize(ctx, { file: xlsx, profile: 'strict' }), 'finalize xlsx').deliveryReady).toBe(true);

    const pptx = 'folder with spaces/产品 路线图.pptx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', pptx] }), 'create pptx');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['batch', pptx],
      batch: { commands: [
        batchCommand({ command: 'add', parent: '/', type: 'slide', props: { layout: 'blank', background: '1E2761' } }),
        batchCommand({ command: 'add', parent: '/slide[1]', type: 'shape', props: { name: 'Title', text: '产品路线图', x: '2cm', y: '2cm', width: '28cm', height: '3cm', size: '40', bold: 'true', color: 'FFFFFF', fill: 'none' } }),
        batchCommand({ command: 'add', parent: '/slide[1]', type: 'shape', props: { text: '稳定 · 完整 · 可审计', x: '2cm', y: '7cm', width: '20cm', height: '2cm', size: '24', color: 'CADCFC', fill: 'none' } }),
        batchCommand({ command: 'add', parent: '/slide[1]', type: 'notes', props: { text: '说明 OfficeCLI 全能力内化后的交付链路。' } }),
      ] },
    }), 'batch pptx');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['batch', pptx],
      batch: { commands: buildMorphCloneCommands(1, 2) },
    }), 'clone morph slide');
    requireSuccess(await handleOfficeDocumentInspect(ctx, { argv: ['get', pptx, '/slide[2]'] }), 'inspect cloned morph slide');
    requireSuccess(await handleOfficeDocumentInspect(ctx, { argv: ['view', pptx, 'outline'] }), 'inspect pptx outline');
    requireSuccess(await handleOfficeDocumentPreview(ctx, { action: 'render', file: pptx, grid: 'auto', renderer: 'html' }), 'render pptx');
    expect(requireSuccess(await handleOfficeDocumentFinalize(ctx, { file: pptx, profile: 'strict' }), 'finalize pptx').deliveryReady).toBe(true);
  }, 240_000);

  integrationIt('embeds the pinned GLB fixture across Morph slides and reports HTML dependency evidence', async () => {
    const directory = join(working, 'folder with spaces');
    mkdirSync(directory, { recursive: true });
    const fixture = join(import.meta.dir, '../../../../benchmarks/officecli/fixtures/sun.glb');
    const model = join(directory, '太阳 模型.glb');
    copyFileSync(fixture, model);
    const file = 'folder with spaces/太阳 Morph 3D.pptx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', file] }), 'create Morph 3D deck');
    const commands: string[] = [];
    for (let slide = 1; slide <= 4; slide += 1) {
      commands.push(batchCommand({
        command: 'add', parent: '/', type: 'slide', props: { background: '0A0A0A', transition: 'morph' },
      }));
      commands.push(batchCommand({
        command: 'add', parent: `/slide[${slide}]`, type: '3dmodel', props: {
          path: model,
          name: 'sun',
          x: slide % 2 ? '15cm' : '1cm',
          y: '1cm',
          width: '16cm',
          height: '16cm',
          roty: String((slide - 1) * 90),
        },
      }));
    }
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['batch', file], batch: { commands }, timeoutMs: 300_000,
    }), 'batch Morph 3D deck');
    for (let slide = 1; slide <= 4; slide += 1) {
      const modelNode = requireSuccess(
        await handleOfficeDocumentInspect(ctx, { argv: ['get', file, `/slide[${slide}]/model3d[1]`] }),
        `inspect Morph 3D slide ${slide}`,
      );
      expect(JSON.stringify(modelNode.data)).toContain('sun');
    }
    const preview = requireSuccess(await handleOfficeDocumentPreview(ctx, {
      action: 'render', file, grid: 'auto', renderer: 'html', timeoutMs: 300_000,
    }), 'render Morph 3D deck');
    expect(preview.data).toMatchObject({
      render: {
        backend: 'html',
        dependencyState: 'runtime-network-assets',
        externalDependencies: expect.arrayContaining(['three']),
      },
    });
    expect(requireSuccess(
      await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }),
      'finalize Morph 3D deck',
    ).deliveryReady).toBe(true);
  }, 360_000);

  integrationIt('runs watch → selection → mark → edit → finalize and releases the owned watch', async () => {
    const file = '中文 目录/完整 Word 文档.docx';
    const start = requireSuccess(await handleOfficeDocumentPreview(ctx, { action: 'start', file }), 'start watch');
    expect(start.data).toMatchObject({ running: true, ownedBySelection: true });
    expect(openedWatchUrl).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?$/);

    const origin = new URL(openedWatchUrl!).origin;
    const selectionResponse = await fetch(`${origin}/api/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ paths: ['/body/p[1]'] }),
    });
    expect(selectionResponse.ok).toBe(true);
    const selection = requireSuccess(await handleOfficeDocumentPreview(ctx, { action: 'selection', file }), 'read selection');
    const selectedPath = ((selection.data as { result?: { results?: Array<{ path?: string }> } })
      .result?.results?.[0]?.path);
    expect(selectedPath?.startsWith('/body/p')).toBe(true);
    requireSuccess(await handleOfficeDocumentPreview(ctx, {
      action: 'mark', file, path: selectedPath!, props: { color: '#E11D48', label: 'review' },
    }), 'mark selection');
    expect(JSON.stringify(requireSuccess(
      await handleOfficeDocumentPreview(ctx, { action: 'get_marks', file }),
      'get marks',
    ).data)).toContain(selectedPath!);
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['set', file, selectedPath!, '--prop', 'color=1E2761'],
    }), 'edit selected path');
    expect(requireSuccess(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }), 'finalize after selection edit').deliveryReady).toBe(true);
    const stopped = requireSuccess(await handleOfficeDocumentPreview(ctx, { action: 'stop', file }), 'stop watch');
    expect(stopped.data).toMatchObject({ stopped: true, remainingSessionReferences: 0 });
  }, 240_000);

  integrationIt('reads the latest resident edits without a model save and still finalizes', async () => {
    const file = 'resident-lease.xlsx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', file] }), 'create resident workbook');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['set', file, '/Sheet1/A1', '--prop', 'value=一次'],
    }), 'first resident set');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['set', file, '/Sheet1/A1', '--prop', 'value=二次'],
    }), 'second resident set');
    const latest = requireSuccess(await handleOfficeDocumentInspect(ctx, {
      argv: ['get', file, '/Sheet1/A1'],
    }), 'get after resident sets');
    expect(JSON.stringify(latest.data)).toContain('二次');
    expect(requireSuccess(await handleOfficeDocumentFinalize(ctx, { file, profile: 'strict' }), 'finalize resident').deliveryReady).toBe(true);
  }, 180_000);

  integrationIt('writes dump and html artifacts that Read can consume, and replays dump through batch.file', async () => {
    const file = 'dump-replay.docx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', file] }), 'create dump doc');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['add', file, '/body', '--type', 'paragraph', '--prop', 'text=可回放正文'],
    }), 'add dump paragraph');
    const dump = requireSuccess(await handleOfficeDocumentInspect(ctx, {
      argv: ['dump', file, '/'],
    }), 'auto dump');
    const dumpPath = dump.command[dump.command.indexOf('--out') + 1];
    expect(typeof dumpPath).toBe('string');
    expect(dumpPath).toContain(join('data', 'office'));
    expect(existsSync(dumpPath!)).toBe(true);

    const html = requireSuccess(await handleOfficeDocumentInspect(ctx, {
      argv: ['view', file, 'html'],
    }), 'view html artifact');
    const htmlPath = html.command[html.command.indexOf('--out') + 1];
    expect(typeof htmlPath).toBe('string');
    expect(readFileSync(htmlPath!, 'utf8')).toContain('可回放正文');

    const replay = 'dump-replay-copy.docx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', replay] }), 'create replay target');
    const replayBatch = join(ctx.dataPath!, 'office', 'replay-batch.json');
    writeFileSync(replayBatch, readFileSync(dumpPath!, 'utf8'));
    const replayed = await handleOfficeDocumentEdit(ctx, {
      argv: ['batch', replay],
      batch: { file: replayBatch },
    });
    if (envelope(replayed).ok) {
      const copied = requireSuccess(await handleOfficeDocumentInspect(ctx, {
        argv: ['view', replay, 'text'],
      }), 'replayed text');
      expect(JSON.stringify(copied.data)).toContain('可回放正文');
    }
  }, 180_000);

  integrationIt('clones a Morph slide through edit.recipe and keeps transition=morph', async () => {
    const file = 'recipe-clone.pptx';
    requireSuccess(await handleOfficeDocumentEdit(ctx, { argv: ['create', file] }), 'create recipe deck');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      argv: ['add', file, '/', '--type', 'slide', '--prop', 'layout=blank'],
    }), 'add first slide');
    requireSuccess(await handleOfficeDocumentEdit(ctx, {
      recipe: { name: 'clone', file, fromSlide: 1, toSlide: 2 },
    }), 'recipe clone');
    const second = requireSuccess(await handleOfficeDocumentInspect(ctx, {
      argv: ['get', file, '/slide[2]'],
    }), 'get cloned slide');
    expect(JSON.stringify(second.data).toLowerCase()).toContain('morph');
  }, 180_000);
});
