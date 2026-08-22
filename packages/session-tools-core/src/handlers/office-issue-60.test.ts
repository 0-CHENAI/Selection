import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import { OFFICE_STANDARD_TASK_HINT, countDuplicateStatusHelp } from '../office-standard-task.ts';
import { OFFICE_WORKFLOW_PROMPT } from '../office-workflow.ts';
import type { OfficeResultEnvelope } from '../office-types.ts';
import {
  clearOfficeRuntimeState,
  executeOfficeCommand,
  releaseOfficeRuntimeSession,
  type OfficeCoordinatorDependencies,
  type OfficecliProcessResult,
} from '../runtime/office-coordinator.ts';
import { resolveOfficecliResources, reviewedOfficecliSchemaCrc } from '../runtime/office-manifest.ts';
import { clearOfficeGuideCache, handleOfficeDocumentGuide } from './office-guide.ts';

const resources = resolveOfficecliResources({
  explicitRoot: resolve(import.meta.dir, '../../../../apps/electron/resources/officecli'),
});
if (!resources) throw new Error('OfficeCLI test resources are missing');
const expectedRuntimeSha256 = resources.manifest.assets[`${process.platform}-${process.arch}`]?.sha256;
if (!expectedRuntimeSha256) throw new Error(`OfficeCLI test asset is missing for ${process.platform}-${process.arch}`);
const expectedSchemaCrc = reviewedOfficecliSchemaCrc(resources.manifest);
const metricsPath = resolve(import.meta.dir, '../../../../benchmarks/officecli/issue-60-workflow-metrics.json');

const roots: string[] = [];

function processResult(stdout: string): OfficecliProcessResult {
  return { stdout, stderr: '', exitCode: 0, timedOut: false, truncated: false };
}

function fixture(sessionId = 'issue-60'): { ctx: SessionToolContext; working: string } {
  const root = mkdtempSync(join(tmpdir(), 'selection-issue-60-'));
  roots.push(root);
  const workspace = join(root, 'workspace');
  const session = join(workspace, 'sessions', sessionId);
  const working = join(workspace, '项目 with spaces');
  mkdirSync(join(session, 'data'), { recursive: true });
  mkdirSync(working, { recursive: true });
  return {
    working,
    ctx: {
      sessionId,
      workspacePath: workspace,
      sessionPath: session,
      dataPath: join(session, 'data'),
      workingDirectory: working,
      get sourcesPath() { return join(workspace, 'sources'); },
      get skillsPath() { return join(workspace, 'skills'); },
      plansFolderPath: join(session, 'plans'),
      callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
      fs: createNodeFileSystem(),
      loadSourceConfig: () => null,
    },
  };
}

function dependencies(): { deps: OfficeCoordinatorDependencies; argvList: string[][] } {
  const argvList: string[][] = [];
  return {
    argvList,
    deps: {
      resolveResources: () => resources,
      resolveRuntime: () => ({ path: '/selection-managed/officecli', source: 'environment' }),
      hashRuntime: async () => expectedRuntimeSha256!,
      runProcess: async (_binary, args) => {
        argvList.push([...args]);
        if (args.length === 1 && args[0] === '--version') return processResult('1.0.144\n');
        if (args.length === 1 && args[0] === '--output-schema-crc') return processResult(`${expectedSchemaCrc}\n`);
        if (args[0] === 'create' && typeof args[1] === 'string') {
          mkdirSync(dirname(args[1]), { recursive: true });
          writeFileSync(args[1], 'PK\u0003\u0004');
        }
        if (args[0] === 'help') return processResult('{"success":true,"data":{"help":"pinned"}}');
        return processResult('{"success":true,"data":{"value":"ok"}}');
      },
    },
  };
}

beforeEach(() => {
  clearOfficeRuntimeState();
  clearOfficeGuideCache();
});

afterEach(() => {
  clearOfficeRuntimeState();
  clearOfficeGuideCache();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Issue #60 Office workflow reuse', () => {
  it('injects a no-help standard recipe and path reuse rules', () => {
    expect(OFFICE_WORKFLOW_PROMPT).toContain('must not call status or help');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('Reuse envelope.cwd and envelope.documentPath');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('After a batch that is not the standard five-step recipe');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('cacheHit');
    expect(OFFICE_STANDARD_TASK_HINT.skipStatusAndHelp).toBe(true);
    expect(OFFICE_STANDARD_TASK_HINT.sequence).toEqual([
      'create', 'batch', 'inspect-outline', 'preview-render', 'finalize',
    ]);
  });

  it('reuses status, help, last document path, and the same guide section', async () => {
    const { ctx, working } = fixture();
    const { deps } = dependencies();
    const file = join(working, '中文 目录', '季度 报告.docx');

    const firstStatus = await executeOfficeCommand(ctx, { argv: ['status'], mode: 'inspect' }, deps);
    const secondStatus = await executeOfficeCommand(ctx, { argv: ['status'], mode: 'inspect' }, deps);
    expect(firstStatus.envelope.ok).toBe(true);
    expect(firstStatus.envelope.cacheHit).toBe(false);
    expect(firstStatus.envelope.data).toMatchObject({
      workingDirectory: firstStatus.cwd,
      standardTask: OFFICE_STANDARD_TASK_HINT,
    });
    expect(secondStatus.envelope.cacheHit).toBe(true);
    expect(secondStatus.envelope.warnings.some(warning => warning.code === 'status_already_provided')).toBe(true);

    const firstHelp = await executeOfficeCommand(ctx, { argv: ['help', 'docx', 'paragraph'], mode: 'inspect' }, deps);
    const secondHelp = await executeOfficeCommand(ctx, { argv: ['help', 'docx', 'paragraph'], mode: 'inspect' }, deps);
    expect(firstHelp.envelope.ok).toBe(true);
    expect(secondHelp.envelope.cacheHit).toBe(true);
    expect(secondHelp.envelope.warnings.some(warning => warning.code === 'help_already_provided')).toBe(true);

    const created = await executeOfficeCommand(ctx, { argv: ['create', file], mode: 'edit' }, deps);
    expect(created.envelope.documentPath).toBe(realpathSync.native(file));
    expect(existsSync(file)).toBe(true);
    const statusAfterCreate = await executeOfficeCommand(ctx, { argv: ['status'], mode: 'inspect' }, deps);
    expect(statusAfterCreate.envelope.documentPath).toBe(realpathSync.native(file));
    expect((statusAfterCreate.envelope.data as { lastDocumentPath?: string }).lastDocumentPath).toBe(realpathSync.native(file));

    const firstGuide = await handleOfficeDocumentGuide(ctx, { guide: 'word' });
    const secondGuide = await handleOfficeDocumentGuide(ctx, { guide: 'word' });
    const firstGuideEnvelope = firstGuide.structuredContent as OfficeResultEnvelope;
    const secondGuideEnvelope = secondGuide.structuredContent as OfficeResultEnvelope;
    expect(firstGuideEnvelope.ok).toBe(true);
    expect(secondGuideEnvelope.cacheHit).toBe(true);
    expect((secondGuideEnvelope.data as { alreadyLoaded?: boolean }).alreadyLoaded).toBe(true);

    await releaseOfficeRuntimeSession(ctx.sessionId);
    const statusAfterRelease = await executeOfficeCommand(ctx, { argv: ['status'], mode: 'inspect' }, deps);
    expect(statusAfterRelease.envelope.cacheHit).toBe(false);
    expect(statusAfterRelease.envelope.documentPath).toBeUndefined();
    expect(statusAfterRelease.envelope.warnings.some(warning => warning.code === 'status_already_provided')).toBe(false);
    expect((statusAfterRelease.envelope.data as { lastDocumentPath?: string }).lastDocumentPath).toBeUndefined();
  });

  it('does not treat runtime metadata reuse as a session status cache hit', async () => {
    const { ctx, working } = fixture();
    const { deps } = dependencies();
    const file = join(working, 'probe.docx');
    await executeOfficeCommand(ctx, { argv: ['create', file], mode: 'edit' }, deps);
    const firstStatus = await executeOfficeCommand(ctx, { argv: ['status'], mode: 'inspect' }, deps);
    expect(firstStatus.envelope.cacheHit).toBe(false);
    expect(firstStatus.envelope.warnings.some(warning => warning.code === 'status_already_provided')).toBe(false);
    expect(firstStatus.envelope.documentPath).toBe(realpathSync.native(file));
    const secondStatus = await executeOfficeCommand(ctx, { argv: ['status'], mode: 'inspect' }, deps);
    expect(secondStatus.envelope.cacheHit).toBe(true);
    expect(secondStatus.envelope.documentPath).toBe(realpathSync.native(file));
  });

  it('creates into existing, missing, spaced, and non-ASCII directories', async () => {
    const { ctx, working } = fixture();
    const { deps } = dependencies();
    mkdirSync(join(working, '已存在'), { recursive: true });
    const outputs = [
      join(working, '已存在', 'report.docx'),
      join(working, '新建', '多层', 'report.docx'),
      join(working, 'folder with spaces', 'report.docx'),
      join(working, '中文 目录', '季度 报告.docx'),
    ];

    for (const output of outputs) {
      const result = await executeOfficeCommand(ctx, { argv: ['create', output], mode: 'edit' }, deps);
      expect(result.envelope.ok, result.envelope.error?.message).toBe(true);
      expect(result.envelope.documentPath).toBe(realpathSync.native(output));
      expect(existsSync(output)).toBe(true);
      expect(readFileSync(output).subarray(0, 2).toString()).toBe('PK');
    }
  });

  it('returns a structured path error and then loop_prevented instead of retrying forever', async () => {
    const { ctx, working } = fixture();
    const { deps } = dependencies();
    const outside = join(tmpdir(), 'selection-issue-60-outside.docx');
    const denied = await executeOfficeCommand(ctx, { argv: ['create', outside], mode: 'edit' }, deps);
    expect(denied.envelope.error?.code).toBe('path_outside_allowed_roots');

    const file = join(working, 'broken.docx');
    writeFileSync(file, 'PK\u0003\u0004');
    const failing = dependencies();
    failing.deps.runProcess = async (_binary, args) => {
      failing.argvList.push([...args]);
      if (args.length === 1 && args[0] === '--version') return processResult('1.0.144\n');
      if (args.length === 1 && args[0] === '--output-schema-crc') return processResult(`${expectedSchemaCrc}\n`);
      return { stdout: '{"success":false,"error":{"code":"bad_path","message":"Unknown document path"}}', stderr: '', exitCode: 1, timedOut: false, truncated: false };
    };
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await executeOfficeCommand(ctx, { argv: ['get', file, '/bad'], mode: 'inspect' }, failing.deps));
    }
    expect(results.slice(0, 3).every(result => result.envelope.error?.upstreamCode === 'bad_path')).toBe(true);
    expect(results[3]?.envelope.error?.code).toBe('loop_prevented');
  });

  it('records a material drop in scripted DOCX/XLSX/PPTX tool calls versus a help-spam workflow', async () => {
    const formats = ['docx', 'xlsx', 'pptx'] as const;
    const tasks = [];
    for (const format of formats) {
      const naive = fixture(`naive-${format}`);
      const optimized = fixture(`optimized-${format}`);
      const naiveDeps = dependencies();
      const optimizedDeps = dependencies();
      const naiveFile = join(naive.working, `标准.${format}`);
      const optimizedFile = join(optimized.working, `标准.${format}`);

      const naiveArgv = [
        ['status'],
        ['help'],
        ['help', format],
        ['help', format, 'paragraph'],
        ['help', format, 'table'],
        ['status'],
        ['help', format],
        ['create', naiveFile],
        ['add', naiveFile, '/body', '--type', 'paragraph'],
        ['add', naiveFile, '/body', '--type', 'paragraph'],
        ['add', naiveFile, '/body', '--type', 'table'],
        ['view', naiveFile, 'outline'],
      ];
      for (const argv of naiveArgv) {
        const mode = argv[0] === 'create' || argv[0] === 'add' ? 'edit' : 'inspect';
        await executeOfficeCommand(naive.ctx, { argv, mode }, naiveDeps.deps);
      }
      const naiveToolCalls = naiveArgv.length + 2;

      const optimizedArgv = [
        ['create', optimizedFile],
        ['batch', optimizedFile],
        ['view', optimizedFile, 'outline'],
      ];
      await executeOfficeCommand(optimized.ctx, { argv: optimizedArgv[0]!, mode: 'edit' }, optimizedDeps.deps);
      await executeOfficeCommand(optimized.ctx, {
        argv: ['batch', optimizedFile],
        mode: 'edit',
        batch: { commands: ['{"command":"add","parent":"/body","type":"paragraph","props":{"text":"摘要"}}'] },
      }, optimizedDeps.deps);
      await executeOfficeCommand(optimized.ctx, { argv: ['view', optimizedFile, 'outline'], mode: 'inspect' }, optimizedDeps.deps);
      const optimizedToolCalls = optimizedArgv.length + 2;

      expect(existsSync(optimizedFile)).toBe(true);
      expect(countDuplicateStatusHelp(naiveArgv)).toBeGreaterThan(0);
      expect(countDuplicateStatusHelp(optimizedArgv)).toBe(0);
      expect(optimizedToolCalls).toBeLessThanOrEqual(naiveToolCalls * 0.6);

      tasks.push({
        format,
        before: {
          officeToolCalls: naiveToolCalls,
          duplicateStatusHelpCalls: countDuplicateStatusHelp(naiveArgv),
        },
        after: {
          officeToolCalls: optimizedToolCalls,
          duplicateStatusHelpCalls: countDuplicateStatusHelp(optimizedArgv),
        },
      });
    }

    const recorded = {
      issue: 60,
      officecliVersion: resources.manifest.version,
      note: 'Scripted engine workflows. Naive repeats status/help; optimized follows the injected standard recipe. preview.render and finalize are counted as the last two planned tools. Mock coordinator timings are not recorded because they are not representative wall-clock.',
      reductionGate: 0.6,
      tasks: tasks.map(task => ({
        format: task.format,
        beforeOfficeToolCalls: task.before.officeToolCalls,
        afterOfficeToolCalls: task.after.officeToolCalls,
        beforeDuplicateStatusHelpCalls: task.before.duplicateStatusHelpCalls,
        afterDuplicateStatusHelpCalls: task.after.duplicateStatusHelpCalls,
      })),
    };
    writeFileSync(metricsPath, `${JSON.stringify(recorded, null, 2)}\n`);
    expect(recorded.tasks.every(task => task.afterDuplicateStatusHelpCalls === 0)).toBe(true);
    expect(recorded.tasks.every(task => task.afterOfficeToolCalls <= task.beforeOfficeToolCalls * 0.6)).toBe(true);
  });
});
