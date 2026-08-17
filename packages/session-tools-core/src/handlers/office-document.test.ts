import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import {
  clearOfficecliVersionCache,
  executeOfficecliForTest,
  handleOfficeDocumentEdit,
  handleOfficeDocumentInspect,
  type OfficecliExecutionDependencies,
} from './office-document.ts';
import { resolveOfficecliBinary } from '../runtime/officecli.ts';

function context(): SessionToolContext {
  return {
    sessionId: 'session-1',
    workspacePath: '/workspace',
    workingDirectory: '/project',
    get sourcesPath() { return '/workspace/sources'; },
    get skillsPath() { return '/workspace/skills'; },
    plansFolderPath: '/workspace/plans',
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: () => true,
      readFile: () => '',
      readFileBuffer: () => Buffer.alloc(0),
      writeFile: () => {},
      isDirectory: path => path === '/project' || path === process.cwd(),
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
  };
}

function payload(result: Awaited<ReturnType<typeof executeOfficecliForTest>>) {
  return result.structuredContent!;
}

beforeEach(() => {
  clearOfficecliVersionCache();
});

describe('Office document native tool execution', () => {
  it('returns a structured availability status and version', async () => {
    const calls: string[][] = [];
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args) => {
        calls.push(args);
        return { stdout: '1.0.144\n', stderr: '', exitCode: 0, timedOut: false, truncated: false };
      },
    };

    const result = await executeOfficecliForTest(context(), { command: 'status' }, 'inspect', deps);

    expect(result.isError).toBe(false);
    expect(payload(result)).toMatchObject({
      ok: true,
      availability: 'available',
      version: '1.0.144',
      command: 'status',
    });
    expect(calls).toEqual([['--version']]);
  });

  it('passes argument tokens without a shell and normalizes successful JSON', async () => {
    const calls: Array<{ args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> = [];
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args, options) => {
        calls.push({ args, cwd: options.cwd as string, env: options.env });
        if (args[0] === '--version') {
          return { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false };
        }
        return {
          stdout: JSON.stringify({ success: true, data: { text: 'hello' } }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
          truncated: false,
        };
      },
      now: (() => {
        let value = 100;
        return () => value += 5;
      })(),
    };

    const result = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['report name.docx', 'text'],
    }, 'inspect', deps);

    expect(calls[1]?.args).toEqual(['view', 'report name.docx', 'text', '--json']);
    expect(calls[1]?.cwd).toBe('/project');
    expect(calls[1]?.env?.OFFICECLI_NO_AUTO_RESIDENT).toBe('1');
    expect(payload(result)).toMatchObject({ ok: true, data: { text: 'hello' }, durationMs: 10 });
  });

  it('preserves structured OfficeCLI errors', async () => {
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args) => args[0] === '--version'
        ? { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false }
        : {
          stdout: JSON.stringify({
            success: false,
            error: {
              error: 'File not found: missing.docx',
              code: 'file_not_found',
              suggestion: 'Check the file path.',
              help: 'officecli create <path>',
            },
          }),
          stderr: '',
          exitCode: 1,
          timedOut: false,
          truncated: false,
        },
    };

    const result = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['missing.docx', 'text'],
    }, 'inspect', deps);

    expect(result.isError).toBe(true);
    expect(payload(result).error).toEqual({
      code: 'file_not_found',
      message: 'File not found: missing.docx',
      suggestion: 'Check the file path.',
      help: 'officecli create <path>',
    });
  });

  it('rejects side-effect flags before starting OfficeCLI', async () => {
    let called = false;
    const result = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['report.docx', 'html', '--out=report.html'],
    }, 'inspect', {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async () => {
        called = true;
        throw new Error('must not run');
      },
    });

    expect(called).toBe(false);
    expect(payload(result)).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments' },
    });
  });

  it('rejects every inspect option that can write files', async () => {
    let called = false;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async () => {
        called = true;
        throw new Error('must not run');
      },
    };

    for (const arguments_ of [
      ['report.docx', '/body/p[1]', '--save', 'image.png'],
      ['report.docx', '/body/p[1]', '--save=image.png'],
      ['report.docx', '/', '-ooutput.json'],
    ]) {
      const result = await executeOfficecliForTest(context(), {
        command: 'get',
        arguments: arguments_,
      }, 'inspect', deps);
      expect(payload(result).error).toMatchObject({ code: 'invalid_arguments' });
    }
    expect(called).toBe(false);
  });

  it('validates the runtime command and status arguments before execution', async () => {
    let called = false;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async () => {
        called = true;
        throw new Error('must not run');
      },
    };

    const managementCommand = await executeOfficecliForTest(context(), {
      command: 'install',
    } as never, 'inspect', deps);
    expect(payload(managementCommand).error).toMatchObject({ code: 'invalid_arguments' });

    const statusWithArguments = await executeOfficecliForTest(context(), {
      command: 'status',
      arguments: ['--help'],
    }, 'inspect', deps);
    expect(payload(statusWithArguments).error).toMatchObject({ code: 'invalid_arguments' });
    expect(called).toBe(false);
  });

  it('serializes structured batch commands', async () => {
    const calls: string[][] = [];
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args) => {
        calls.push(args);
        return args[0] === '--version'
          ? { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false }
          : { stdout: '{"success":true,"data":"ok"}', stderr: '', exitCode: 0, timedOut: false, truncated: false };
      },
    };
    const commands = [{ command: 'set', path: '/Sheet1/A1', props: { value: 'Done' } }];

    await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommands: commands,
    }, 'edit', deps);

    expect(calls[1]).toEqual(['batch', 'data.xlsx', '--commands', JSON.stringify(commands), '--json']);
  });

  it('requires structured batch input and rejects resident or management commands inside it', async () => {
    let called = false;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async () => {
        called = true;
        throw new Error('must not run');
      },
    };

    const externalInput = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx', '--input', 'commands.json'],
    }, 'edit', deps);
    expect(payload(externalInput).error).toMatchObject({ code: 'invalid_arguments' });

    const residentCommand = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommands: [{ command: 'open', file: 'data.xlsx' }],
    }, 'edit', deps);
    expect(payload(residentCommand).error).toMatchObject({ code: 'invalid_arguments' });

    const legacyResidentCommand = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommands: [{ op: 'watch', file: 'data.xlsx' }],
    }, 'edit', deps);
    expect(payload(legacyResidentCommand).error).toMatchObject({ code: 'invalid_arguments' });
    expect(called).toBe(false);
  });

  it('applies timeoutMs to the whole invocation including version detection', async () => {
    const timeouts: number[] = [];
    let clock = 0;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args, options) => {
        timeouts.push(options.timeoutMs);
        if (args[0] === '--version') {
          clock = 20;
          return { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false };
        }
        clock = 80;
        return { stdout: '{"success":true,"data":"ok"}', stderr: '', exitCode: 0, timedOut: false, truncated: false };
      },
      now: () => clock,
    };

    const result = await executeOfficecliForTest(context(), {
      command: 'validate',
      arguments: ['report.docx'],
      timeoutMs: 100,
    }, 'inspect', deps);

    expect(timeouts).toEqual([100, 80]);
    expect(payload(result)).toMatchObject({ ok: true, durationMs: 80 });
  });

  it('returns stable unavailable, timeout, and process errors', async () => {
    const unavailable = await executeOfficecliForTest(context(), { command: 'status' }, 'inspect', {
      resolveRuntime: () => undefined,
    });
    expect(payload(unavailable)).toMatchObject({
      availability: 'unavailable',
      error: { code: 'officecli_unavailable' },
    });

    const timeout = await executeOfficecliForTest(context(), { command: 'validate', arguments: ['a.docx'] }, 'inspect', {
      resolveRuntime: () => ({ path: '/managed/timeout', source: 'environment' }),
      runProcess: async (_binary, args) => args[0] === '--version'
        ? { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false }
        : { stdout: '', stderr: '', exitCode: null, timedOut: true, truncated: false },
    });
    expect(payload(timeout).error).toMatchObject({ code: 'timeout' });

    const failed = await executeOfficecliForTest(context(), { command: 'validate', arguments: ['a.docx'] }, 'inspect', {
      resolveRuntime: () => ({ path: '/managed/failure', source: 'environment' }),
      runProcess: async (_binary, args) => {
        if (args[0] === '--version') {
          return { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false };
        }
        throw new Error('spawn EACCES');
      },
    });
    expect(payload(failed).error).toEqual({ code: 'execution_failed', message: 'spawn EACCES' });
  });

  it('classifies non-JSON argument failures and marks truncated output', async () => {
    const invalid = await executeOfficecliForTest(context(), {
      command: 'query',
      arguments: ['a.docx'],
    }, 'inspect', {
      resolveRuntime: () => ({ path: '/managed/invalid', source: 'environment' }),
      runProcess: async (_binary, args) => args[0] === '--version'
        ? { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false }
        : { stdout: '', stderr: 'Required argument missing: selector', exitCode: 1, timedOut: false, truncated: false },
    });
    expect(payload(invalid).error).toMatchObject({ code: 'invalid_arguments' });

    const truncated = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['a.docx', 'text'],
    }, 'inspect', {
      resolveRuntime: () => ({ path: '/managed/truncated', source: 'environment' }),
      runProcess: async (_binary, args) => args[0] === '--version'
        ? { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false }
        : { stdout: 'x'.repeat(100_000), stderr: '', exitCode: 0, timedOut: false, truncated: true },
    });
    expect(payload(truncated)).toMatchObject({ ok: true, truncated: true });
    expect((payload(truncated).data as string).length).toBe(100_000);
  });

  it('creates, edits, and reads docx, xlsx, and pptx through native handlers', async () => {
    if (!resolveOfficecliBinary()) return;

    const root = mkdtempSync(join(tmpdir(), 'office-native-smoke-'));
    const workDir = join(root, '巡察工作');
    mkdirSync(workDir, { recursive: true });
    const realContext: SessionToolContext = {
      ...context(),
      workingDirectory: workDir,
      fs: {
        exists: existsSync,
        readFile: path => readFileSync(path, 'utf8'),
        readFileBuffer: path => readFileSync(path),
        writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
        isDirectory: path => existsSync(path) && statSync(path).isDirectory(),
        readdir: readdirSync,
        stat: path => {
          const stats = statSync(path);
          return { size: stats.size, isDirectory: () => stats.isDirectory() };
        },
      },
    };

    try {
      const createDocx = await handleOfficeDocumentEdit(realContext, {
        command: 'create',
        arguments: ['报告.docx'],
      });
      expect(payload(createDocx).ok).toBe(true);
      await handleOfficeDocumentEdit(realContext, {
        command: 'add',
        arguments: ['报告.docx', '/body', '--type', 'paragraph', '--prop', 'text=巡察工作摘要'],
      });
      const docx = await handleOfficeDocumentInspect(realContext, {
        command: 'view',
        arguments: ['报告.docx', 'text'],
      });
      expect(JSON.stringify(payload(docx).data)).toContain('巡察工作摘要');

      await handleOfficeDocumentEdit(realContext, {
        command: 'create',
        arguments: ['数据.xlsx'],
      });
      await handleOfficeDocumentEdit(realContext, {
        command: 'batch',
        arguments: ['数据.xlsx'],
        batchCommands: [{ command: 'set', path: '/Sheet1/A1', props: { value: '姓名' } }],
      });
      const xlsx = await handleOfficeDocumentInspect(realContext, {
        command: 'view',
        arguments: ['数据.xlsx', 'text'],
      });
      expect(JSON.stringify(payload(xlsx).data)).toContain('姓名');

      await handleOfficeDocumentEdit(realContext, {
        command: 'create',
        arguments: ['汇报.pptx'],
      });
      await handleOfficeDocumentEdit(realContext, {
        command: 'add',
        arguments: ['汇报.pptx', '/', '--type', 'slide', '--prop', 'title=巡察汇报'],
      });
      const pptx = await handleOfficeDocumentInspect(realContext, {
        command: 'view',
        arguments: ['汇报.pptx', 'text'],
      });
      expect(JSON.stringify(payload(pptx).data)).toContain('巡察汇报');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
