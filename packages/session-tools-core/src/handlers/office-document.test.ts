import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import {
  clearOfficecliVersionCache,
  clearOfficeInspectBudget,
  executeOfficecliForTest,
  handleOfficeDocumentEdit,
  handleOfficeDocumentInspect,
  type OfficecliExecutionDependencies,
} from './office-document.ts';
import {
  OFFICE_INSPECT_BUDGET_LIMIT,
  OFFICE_MAX_BATCH_FILE_BYTES,
  OFFICE_MAX_INLINE_ARGUMENTS_CHARS,
  OFFICE_MAX_INLINE_BATCH_CHARS,
  OFFICE_MAX_INLINE_BATCH_COMMANDS,
  OFFICE_PAYLOAD_TOO_LARGE_SUGGESTION,
  OFFICE_REFRESH_NON_WINDOWS_NOTE,
  OFFICE_TRUNCATED_PREVIEW_CHARS,
  OFFICE_TRUNCATION_SUGGESTION,
} from '../office-workflow.ts';
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

function contextWithFiles(
  files: Record<string, string>,
  sizes: Record<string, number> = {},
): SessionToolContext {
  const base = context();
  return {
    ...base,
    fs: {
      ...base.fs,
      exists: path => path in files || base.fs.exists(path),
      readFile: path => {
        if (path in files) return files[path]!;
        return base.fs.readFile(path);
      },
      stat: path => ({
        size: sizes[path] ?? files[path]?.length ?? 0,
        isDirectory: () => false,
      }),
    },
  };
}

function successDeps(): OfficecliExecutionDependencies {
  return {
    resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
    runProcess: async (_binary, args) => args[0] === '--version'
      ? { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false }
      : { stdout: '{"success":true,"data":"ok"}', stderr: '', exitCode: 0, timedOut: false, truncated: false },
  };
}

beforeEach(() => {
  clearOfficecliVersionCache();
  clearOfficeInspectBudget();
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

  it('passes a validated batchCommandsFile to OfficeCLI as --input', async () => {
    const calls: string[][] = [];
    const commands = [{ command: 'set', path: '/Sheet1/A1', props: { value: 'Done' } }];
    const filePath = join('/project', 'commands.json');
    const result = await executeOfficecliForTest(contextWithFiles({
      [filePath]: JSON.stringify(commands),
    }), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args) => {
        calls.push(args);
        return args[0] === '--version'
          ? { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false }
          : { stdout: '{"success":true,"data":"ok"}', stderr: '', exitCode: 0, timedOut: false, truncated: false };
      },
    });

    expect(payload(result).ok).toBe(true);
    expect(calls[1]).toEqual(['batch', 'data.xlsx', '--input', filePath, '--json']);
  });

  it('rejects batchCommandsFile that is outside the workspace, not JSON, or too large', async () => {
    let called = false;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async () => {
        called = true;
        throw new Error('must not run');
      },
    };
    const escaped = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: '../../etc/secret.json',
    }, 'edit', deps);
    const notJson = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.txt',
    }, 'edit', deps);
    const invalidJson = await executeOfficecliForTest(contextWithFiles({
      [join('/project', 'commands.json')]: '{not-json',
    }), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);
    const notArray = await executeOfficecliForTest(contextWithFiles({
      [join('/project', 'commands.json')]: JSON.stringify({ command: 'set' }),
    }), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);
    const oversized = await executeOfficecliForTest(contextWithFiles(
      { [join('/project', 'commands.json')]: '[]' },
      { [join('/project', 'commands.json')]: OFFICE_MAX_BATCH_FILE_BYTES + 1 },
    ), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);
    const forbidden = await executeOfficecliForTest(contextWithFiles({
      [join('/project', 'commands.json')]: JSON.stringify([{ command: 'open', file: 'data.xlsx' }]),
    }), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);
    const directoryCtx = contextWithFiles({ [join('/project', 'commands.json')]: '[]' });
    directoryCtx.fs.stat = () => ({ size: 0, isDirectory: () => true });
    const directory = await executeOfficecliForTest(directoryCtx, {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);
    const emptyFile = await executeOfficecliForTest(contextWithFiles({
      [join('/project', 'commands.json')]: '[]',
    }), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);
    const oversizedContent = await executeOfficecliForTest(contextWithFiles(
      { [join('/project', 'commands.json')]: 'x'.repeat(OFFICE_MAX_BATCH_FILE_BYTES + 1) },
      { [join('/project', 'commands.json')]: 32 },
    ), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);
    const missingCtx = context();
    missingCtx.fs.exists = () => false;
    const missingFile = await executeOfficecliForTest(missingCtx, {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);

    expect(payload(escaped).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(notJson).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(invalidJson).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(notArray).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(oversized)).toMatchObject({
      error: {
        code: 'payload_too_large',
        suggestion: OFFICE_PAYLOAD_TOO_LARGE_SUGGESTION,
      },
    });
    expect(payload(forbidden).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(directory).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(emptyFile).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(oversizedContent).error).toMatchObject({ code: 'payload_too_large' });
    expect(payload(missingFile).error).toMatchObject({ code: 'invalid_arguments' });
    expect(called).toBe(false);
  });

  it('requires exactly one of batchCommands or batchCommandsFile', async () => {
    let called = false;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async () => {
        called = true;
        throw new Error('must not run');
      },
    };
    const missing = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
    }, 'edit', deps);
    const emptyInline = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommands: [],
    }, 'edit', deps);
    const both = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommands: [{ command: 'set', path: '/Sheet1/A1', props: { value: 'Done' } }],
      batchCommandsFile: 'commands.json',
    }, 'edit', deps);

    expect(payload(missing).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(emptyInline).error).toMatchObject({ code: 'invalid_arguments' });
    expect(payload(both).error).toMatchObject({ code: 'invalid_arguments' });
    expect(called).toBe(false);
  });

  it('rejects oversized inline batchCommands and arguments', async () => {
    let called = false;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async () => {
        called = true;
        throw new Error('must not run');
      },
    };
    const tooMany = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommands: Array.from({ length: OFFICE_MAX_INLINE_BATCH_COMMANDS + 1 }, (_, index) => ({
        command: 'set',
        path: `/Sheet1/A${index + 1}`,
        props: { value: 'x' },
      })),
    }, 'edit', deps);
    const tooWide = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['data.xlsx'],
      batchCommands: [{
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: '字'.repeat(OFFICE_MAX_INLINE_BATCH_CHARS) },
      }],
    }, 'edit', deps);
    const hugeProp = await executeOfficecliForTest(context(), {
      command: 'add',
      arguments: ['report.docx', '/body', '--type', 'paragraph', `--prop`, `text=${'字'.repeat(OFFICE_MAX_INLINE_ARGUMENTS_CHARS)}`],
    }, 'edit', deps);
    const hugeBatchArgs = await executeOfficecliForTest(context(), {
      command: 'batch',
      arguments: ['report.docx', `--prop`, `text=${'字'.repeat(OFFICE_MAX_INLINE_ARGUMENTS_CHARS)}`],
      batchCommands: [{ command: 'set', path: '/Sheet1/A1', props: { value: 'Done' } }],
    }, 'edit', deps);

    expect(payload(tooMany)).toMatchObject({
      error: {
        code: 'payload_too_large',
        suggestion: OFFICE_PAYLOAD_TOO_LARGE_SUGGESTION,
      },
    });
    expect(payload(tooWide).error).toMatchObject({ code: 'payload_too_large' });
    expect(payload(hugeProp).error).toMatchObject({ code: 'payload_too_large' });
    expect(payload(hugeBatchArgs).error).toMatchObject({ code: 'payload_too_large' });
    expect(JSON.stringify(payload(tooMany))).toContain('batchCommandsFile');
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

    const timeout = await executeOfficecliForTest(context(), { command: 'validate', arguments: ['timeout.docx'] }, 'inspect', {
      resolveRuntime: () => ({ path: '/managed/timeout', source: 'environment' }),
      runProcess: async (_binary, args) => args[0] === '--version'
        ? { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false }
        : { stdout: '', stderr: '', exitCode: null, timedOut: true, truncated: false },
    });
    expect(payload(timeout).error).toMatchObject({ code: 'timeout' });

    const failed = await executeOfficecliForTest(context(), { command: 'validate', arguments: ['failure.docx'] }, 'inspect', {
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
    const truncatedPayload = payload(truncated);
    const truncatedText = truncated.content[0]?.type === 'text' ? truncated.content[0].text : '';
    expect(truncatedPayload).toMatchObject({
      ok: true,
      truncated: true,
      suggestion: OFFICE_TRUNCATION_SUGGESTION,
    });
    expect(truncatedPayload.data).toBeUndefined();
    expect(typeof truncatedPayload.preview).toBe('string');
    expect((truncatedPayload.preview as string).length).toBe(OFFICE_TRUNCATED_PREVIEW_CHARS);
    expect(truncatedText).toContain('view outline');
    expect(truncatedText.length).toBeLessThan(5_000);
    expect(JSON.stringify(truncatedPayload).length).toBeLessThan(5_000);
  });

  it('includes the Word+Windows note only for non-Windows DOCX refresh', async () => {
    const docx = await executeOfficecliForTest(context(), {
      command: 'refresh',
      arguments: ['report.docx'],
    }, 'edit', {
      ...successDeps(),
      platform: 'darwin',
    });
    const workbook = await executeOfficecliForTest(context(), {
      command: 'refresh',
      arguments: ['data.xlsx'],
    }, 'edit', {
      ...successDeps(),
      platform: 'darwin',
    });

    const text = docx.content[0]?.type === 'text' ? docx.content[0].text : '';
    expect(payload(docx)).toMatchObject({
      ok: true,
      platformNote: OFFICE_REFRESH_NON_WINDOWS_NOTE,
    });
    expect(text).toContain('Word + Windows');
    expect(payload(workbook).platformNote).toBeUndefined();
  });

  it('does not rerun OfficeCLI for the same inspect fingerprint', async () => {
    let commandRuns = 0;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args) => {
        if (args[0] === '--version') {
          return { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false };
        }
        commandRuns += 1;
        return { stdout: '{"success":true,"data":"ok"}', stderr: '', exitCode: 0, timedOut: false, truncated: false };
      },
    };

    const first = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['report.docx', 'outline'],
    }, 'inspect', deps);
    const second = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['./report.docx', 'outline'],
    }, 'inspect', deps);

    expect(payload(first).ok).toBe(true);
    expect(commandRuns).toBe(1);
    expect(second.isError).toBe(false);
    expect(payload(second)).toMatchObject({
      ok: true,
      code: 'already_checked',
    });

    const absolute = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['/project/report.docx', 'outline'],
    }, 'inspect', deps);
    expect(payload(absolute)).toMatchObject({ ok: true, code: 'already_checked' });
    expect(commandRuns).toBe(1);
  });

  it('allows retrying a failed inspect and does not spend budget on it', async () => {
    let commandRuns = 0;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args) => {
        if (args[0] === '--version') {
          return { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false };
        }
        commandRuns += 1;
        if (commandRuns === 1) {
          return { stdout: '', stderr: '', exitCode: null, timedOut: true, truncated: false };
        }
        return { stdout: '{"success":true,"data":"ok"}', stderr: '', exitCode: 0, timedOut: false, truncated: false };
      },
    };

    const timedOut = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['report.docx', 'outline'],
    }, 'inspect', deps);
    const retried = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['report.docx', 'outline'],
    }, 'inspect', deps);

    expect(payload(timedOut).error).toMatchObject({ code: 'timeout' });
    expect(payload(retried).ok).toBe(true);
    expect(commandRuns).toBe(2);
  });

  it('stops counted inspects after the session budget and ignores status/help', async () => {
    let commandRuns = 0;
    const deps: OfficecliExecutionDependencies = {
      resolveRuntime: () => ({ path: '/managed/officecli', source: 'environment' }),
      runProcess: async (_binary, args) => {
        if (args[0] === '--version') {
          return { stdout: '1.0.144', stderr: '', exitCode: 0, timedOut: false, truncated: false };
        }
        commandRuns += 1;
        return { stdout: '{"success":true,"data":"ok"}', stderr: '', exitCode: 0, timedOut: false, truncated: false };
      },
    };

    for (let i = 0; i < 3; i++) {
      const help = await executeOfficecliForTest(context(), {
        command: 'help',
        arguments: ['docx', 'heading'],
      }, 'inspect', deps);
      expect(payload(help).ok).toBe(true);
    }

    const inspects = [
      ['view', ['report.docx', 'outline']],
      ['view', ['report.docx', 'text']],
      ['validate', ['report.docx']],
      ['get', ['report.docx', '/body']],
    ] as const;

    for (const [command, arguments_] of inspects) {
      const result = await executeOfficecliForTest(context(), {
        command,
        arguments: [...arguments_],
      }, 'inspect', deps);
      expect(payload(result).ok).toBe(true);
    }
    expect(inspects.length).toBe(OFFICE_INSPECT_BUDGET_LIMIT);

    const exhausted = await executeOfficecliForTest(context(), {
      command: 'query',
      arguments: ['report.docx', '/body'],
    }, 'inspect', deps);

    expect(exhausted.isError).toBe(false);
    expect(payload(exhausted)).toMatchObject({
      ok: true,
      code: 'verification_budget_exhausted',
    });
    expect(commandRuns).toBe(3 + OFFICE_INSPECT_BUDGET_LIMIT);
  });

  it('resets the inspect budget after a successful edit', async () => {
    const deps = successDeps();
    const inspects = [
      ['view', ['report.docx', 'outline']],
      ['view', ['report.docx', 'text']],
      ['validate', ['report.docx']],
      ['dump', ['report.docx']],
    ] as const;

    for (const [command, arguments_] of inspects) {
      await executeOfficecliForTest(context(), {
        command,
        arguments: [...arguments_],
      }, 'inspect', deps);
    }

    const blocked = await executeOfficecliForTest(context(), {
      command: 'raw',
      arguments: ['report.docx'],
    }, 'inspect', deps);
    expect(payload(blocked)).toMatchObject({ ok: true, code: 'verification_budget_exhausted' });

    const refresh = await executeOfficecliForTest(context(), {
      command: 'refresh',
      arguments: ['report.docx'],
    }, 'edit', deps);
    expect(payload(refresh).ok).toBe(true);

    const stillBlocked = await executeOfficecliForTest(context(), {
      command: 'raw',
      arguments: ['report.docx'],
    }, 'inspect', deps);
    expect(payload(stillBlocked)).toMatchObject({ ok: true, code: 'verification_budget_exhausted' });

    const edit = await executeOfficecliForTest(context(), {
      command: 'add',
      arguments: ['report.docx', '/body', '--type', 'paragraph', '--prop', 'text=Summary'],
    }, 'edit', deps);
    expect(payload(edit).ok).toBe(true);

    const afterEdit = await executeOfficecliForTest(context(), {
      command: 'view',
      arguments: ['report.docx', 'outline'],
    }, 'inspect', deps);
    expect(payload(afterEdit).ok).toBe(true);
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
