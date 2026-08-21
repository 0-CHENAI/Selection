import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import type { OfficeResultEnvelope } from '../office-types.ts';
import {
  clearOfficeRuntimeState,
  executeOfficeCommand,
  releaseOfficeRuntimeSession,
  wasOfficeArtifactMutatedBySession,
  type OfficecliProcessResult,
  type OfficeCoordinatorDependencies,
} from '../runtime/office-coordinator.ts';
import { resolveOfficecliResources } from '../runtime/office-manifest.ts';

const resources = resolveOfficecliResources({
  explicitRoot: resolve(import.meta.dir, '../../../../apps/electron/resources/officecli'),
});
if (!resources) throw new Error('OfficeCLI test resources are missing');
const expectedRuntimeSha256 = resources.manifest.assets[`${process.platform}-${process.arch}`]?.sha256;
if (!expectedRuntimeSha256) throw new Error(`OfficeCLI test asset is missing for ${process.platform}-${process.arch}`);

const roots: string[] = [];

interface Fixture {
  root: string;
  workspace: string;
  session: string;
  working: string;
  ctx: SessionToolContext;
}

interface RecordedCall {
  binary: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

function fixture(options: { workingDirectory?: string | null; sessionId?: string } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'selection-office-runtime-'));
  roots.push(root);
  const workspace = join(root, 'workspace');
  const session = join(workspace, 'sessions', options.sessionId ?? 'session-1');
  const working = join(workspace, '项目 with spaces');
  mkdirSync(join(session, 'data'), { recursive: true });
  mkdirSync(working, { recursive: true });
  const ctx: SessionToolContext = {
    sessionId: options.sessionId ?? 'session-1',
    workspacePath: workspace,
    sessionPath: session,
    dataPath: join(session, 'data'),
    ...(options.workingDirectory !== null
      ? { workingDirectory: options.workingDirectory ?? working }
      : {}),
    get sourcesPath() { return join(workspace, 'sources'); },
    get skillsPath() { return join(workspace, 'skills'); },
    plansFolderPath: join(session, 'plans'),
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: createNodeFileSystem(),
    loadSourceConfig: () => null,
  };
  return { root, workspace, session, working, ctx };
}

function officeFile(path: string, contents = 'fixture'): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function processResult(
  stdout: string,
  overrides: Partial<OfficecliProcessResult> = {},
): OfficecliProcessResult {
  return {
    stdout,
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: false,
    ...overrides,
  };
}

function dependencies(
  execute: (args: string[]) => OfficecliProcessResult | Promise<OfficecliProcessResult> = () =>
    processResult('{"success":true,"data":{"value":"ok"}}'),
): { deps: OfficeCoordinatorDependencies; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    deps: {
      resolveResources: () => resources,
      resolveRuntime: () => ({ path: '/selection-managed/officecli', source: 'environment' }),
      hashRuntime: async () => expectedRuntimeSha256!,
      runProcess: async (binary, args, options) => {
        calls.push({
          binary,
          args: [...args],
          cwd: options.cwd as string | undefined,
          env: options.env,
          timeoutMs: options.timeoutMs,
        });
        if (args.length === 1 && args[0] === '--version') return processResult('1.0.144\n');
        if (args.length === 1 && args[0] === '--output-schema-crc') return processResult('b2b0b395\n');
        return execute(args);
      },
    },
  };
}

function envelope(result: Awaited<ReturnType<typeof executeOfficeCommand>>): OfficeResultEnvelope {
  return result.envelope;
}

function commandCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter(call => !['--version', '--output-schema-crc'].includes(call.args[0] ?? ''));
}

beforeEach(() => clearOfficeRuntimeState());

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Office Runtime Coordinator', () => {
  it('validates the pinned version/schema once and reports truthful status cache hits', async () => {
    const f = fixture();
    const { deps, calls } = dependencies();

    const first = await executeOfficeCommand(f.ctx, { argv: ['status'], mode: 'inspect' }, deps);
    const second = await executeOfficeCommand(f.ctx, { argv: ['status'], mode: 'inspect' }, deps);

    expect(envelope(first)).toMatchObject({
      ok: true,
      version: '1.0.144',
      schemaCrc: 'b2b0b395',
      command: ['status'],
      cwd: realpathSync.native(f.working),
      cacheHit: false,
    });
    expect(envelope(second).cacheHit).toBe(true);
    expect(calls.map(call => call.args)).toEqual([
      ['--version'],
      ['--output-schema-crc'],
    ]);
  });

  it('passes Chinese, spaces, and shell metacharacters as native argv tokens', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, '报告 name.docx'));
    const sentinel = join(f.working, 'must-not-exist');
    const pathToken = `/body/p[1];$(touch ${sentinel})`;
    const { deps, calls } = dependencies();

    const result = await executeOfficeCommand(f.ctx, {
      argv: ['get', file, pathToken],
      mode: 'inspect',
    }, deps);

    expect(result.envelope.ok).toBe(true);
    expect(commandCalls(calls)[0]?.args).toEqual(['get', file, pathToken, '--json']);
    expect(commandCalls(calls)[0]?.cwd).toBe(realpathSync.native(f.working));
    expect(commandCalls(calls)[0]?.env).toMatchObject({
      OFFICECLI_SKIP_UPDATE: '1',
      OFFICECLI_NO_AUTO_INSTALL: '1',
      OFFICECLI_NO_AUTO_RESIDENT: '1',
      OFFICECLI_RESIDENT_FLUSH: 'each',
      NO_COLOR: '1',
    });
    expect(existsSync(sentinel)).toBe(false);
  });

  it('uses workingDirectory, then sessionPath, and never falls back to process.cwd()', async () => {
    const noExplicit = fixture({ workingDirectory: null });
    const { deps } = dependencies();
    const fallback = await executeOfficeCommand(noExplicit.ctx, { argv: ['status'], mode: 'inspect' }, deps);
    expect(fallback.envelope.cwd).toBe(realpathSync.native(noExplicit.session));

    clearOfficeRuntimeState();
    const invalid = fixture({ workingDirectory: join(noExplicit.root, 'missing') });
    const failed = await executeOfficeCommand(invalid.ctx, { argv: ['status'], mode: 'inspect' }, deps);
    expect(failed.envelope).toMatchObject({
      ok: false,
      error: { code: 'working_directory_not_found', category: 'path' },
    });
    expect(failed.envelope.cwd).not.toBe(process.cwd());
  });

  it('blocks management, lifecycle, unknown, and inspect-render commands before execution', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'report.docx'));
    const { deps, calls } = dependencies();
    const cases = [
      { argv: ['install'], mode: 'inspect' as const, code: 'management_command_forbidden' },
      { argv: ['open', file], mode: 'edit' as const, code: 'management_command_forbidden' },
      { argv: ['future-write', file], mode: 'edit' as const, code: 'command_not_editable' },
      { argv: ['view', file, 'screenshot'], mode: 'inspect' as const, code: 'render_requires_preview' },
      { argv: ['dump', file, '/', '--out', 'dump.json'], mode: 'inspect' as const, code: 'read_output_forbidden' },
    ];

    for (const testCase of cases) {
      const result = await executeOfficeCommand(f.ctx, testCase, deps);
      expect(result.envelope.error?.code).toBe(testCase.code);
    }
    expect(calls).toHaveLength(0);
  });

  it('hard-blocks management commands even if a tampered manifest misclassifies them', async () => {
    const f = fixture();
    const { deps, calls } = dependencies();
    deps.resolveResources = () => ({
      ...resources,
      manifest: {
        ...resources.manifest,
        commandPolicy: {
          ...resources.manifest.commandPolicy,
          read: [...resources.manifest.commandPolicy.read, 'install'],
          admin: resources.manifest.commandPolicy.admin.filter(command => command !== 'install'),
        },
      },
    });

    const result = await executeOfficeCommand(f.ctx, { argv: ['install'], mode: 'inspect' }, deps);

    expect(result.envelope.error?.code).toBe('management_command_forbidden');
    expect(calls).toHaveLength(0);
  });

  it('rejects an unreviewed runtime checksum before reading executable metadata', async () => {
    const f = fixture();
    const { deps, calls } = dependencies();
    deps.hashRuntime = async () => '0'.repeat(64);

    const result = await executeOfficeCommand(f.ctx, { argv: ['status'], mode: 'inspect' }, deps);

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: 'runtime_checksum_mismatch', category: 'dependency' },
      data: { actualSha256: '0'.repeat(64), expectedSha256: expectedRuntimeSha256 },
    });
    expect(calls).toHaveLength(0);
  });

  it('translates the stable get-marks inspect alias to native watch marks grammar', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'marked deck.pptx'));
    const { deps, calls } = dependencies();

    const result = await executeOfficeCommand(f.ctx, {
      argv: ['get-marks', file],
      mode: 'inspect',
    }, deps);

    expect(result.envelope.ok).toBe(true);
    expect(commandCalls(calls)[0]?.args).toEqual(['watch', file, 'marks', file, '--json']);
    expect(result.envelope.command).toEqual(['watch', file, 'marks', file, '--json']);
  });

  it('enforces missing, outside, symlink-escaped, parent-file, and long paths', async () => {
    const f = fixture();
    const outsideRoot = mkdtempSync(join(tmpdir(), 'selection-office-outside-'));
    roots.push(outsideRoot);
    const outside = officeFile(join(outsideRoot, 'outside.docx'));
    const link = join(f.working, 'escaped.docx');
    symlinkSync(outside, link);
    const parentFile = officeFile(join(f.working, 'not-a-directory'));
    const { deps } = dependencies();

    const missing = await executeOfficeCommand(f.ctx, { argv: ['get', 'missing.docx', '/'], mode: 'inspect' }, deps);
    const escaped = await executeOfficeCommand(f.ctx, { argv: ['get', link, '/'], mode: 'inspect' }, deps);
    const outsideResult = await executeOfficeCommand(f.ctx, { argv: ['get', outside, '/'], mode: 'inspect' }, deps);
    const parentResult = await executeOfficeCommand(f.ctx, {
      argv: ['create', join(parentFile, 'new.docx')],
      mode: 'edit',
    }, deps);
    const longResult = await executeOfficeCommand(f.ctx, {
      argv: ['create', join(f.working, `${'a'.repeat(4100)}.docx`)],
      mode: 'edit',
    }, deps);

    expect(missing.envelope.error?.code).toBe('file_not_found');
    expect(escaped.envelope.error?.code).toBe('path_outside_allowed_roots');
    expect(outsideResult.envelope.error?.code).toBe('path_outside_allowed_roots');
    expect(parentResult.envelope.error?.code).toBe('output_parent_is_file');
    expect(longResult.envelope.error?.code).toBe('path_too_long');
  });

  it('creates authorized nested output directories and requires --force for existing outputs', async () => {
    const f = fixture();
    const output = join(f.working, '新目录', '多层', 'new file.docx');
    const existing = officeFile(join(f.working, 'existing.docx'));
    const { deps, calls } = dependencies();

    const created = await executeOfficeCommand(f.ctx, { argv: ['create', output], mode: 'edit' }, deps);
    const refused = await executeOfficeCommand(f.ctx, { argv: ['create', existing], mode: 'edit' }, deps);
    const forced = await executeOfficeCommand(f.ctx, { argv: ['create', existing, '--force'], mode: 'edit' }, deps);

    expect(created.envelope.ok).toBe(true);
    expect(existsSync(dirname(output))).toBe(true);
    expect(refused.envelope.error?.code).toBe('output_exists');
    expect(forced.envelope.ok).toBe(true);
    expect(commandCalls(calls).map(call => call.args)).toContainEqual(['create', existing, '--force', '--json']);
  });

  it('revision-caches exact successful reads without a global inspect budget', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'many-reads.docx'));
    const { deps, calls } = dependencies();

    for (let index = 0; index < 8; index += 1) {
      const result = await executeOfficeCommand(f.ctx, {
        argv: ['get', file, `/body/p[${index + 1}]`],
        mode: 'inspect',
        cacheable: true,
      }, deps);
      expect(result.envelope.ok).toBe(true);
    }
    const cached = await executeOfficeCommand(f.ctx, {
      argv: ['get', file, '/body/p[1]'],
      mode: 'inspect',
      cacheable: true,
    }, deps);

    expect(cached.envelope.cacheHit).toBe(true);
    expect(commandCalls(calls)).toHaveLength(8);
  });

  it('returns the real upstream failure three times, then loop_prevented', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'broken.docx'));
    const { deps, calls } = dependencies(() => processResult(
      '{"success":false,"error":{"code":"bad_path","message":"Unknown document path"}}',
      { exitCode: 1 },
    ));
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await executeOfficeCommand(f.ctx, {
        argv: ['get', file, '/bad'],
        mode: 'inspect',
      }, deps));
    }

    expect(results.slice(0, 3).map(result => result.envelope.error?.upstreamCode))
      .toEqual(['bad_path', 'bad_path', 'bad_path']);
    expect(results[3]?.envelope.error?.code).toBe('loop_prevented');
    expect(results[3]?.envelope.ok).toBe(false);
    expect(commandCalls(calls)).toHaveLength(3);
  });

  it('invalidates read cache and increments revision after mutation', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'revision.docx'));
    const { deps, calls } = dependencies(args => processResult(JSON.stringify({
      success: true,
      data: args[0] === 'refresh' ? { backend: 'libreoffice-native' } : { value: 'ok' },
    })));

    const before = await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deps);
    const cached = await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deps);
    const edit = await executeOfficeCommand(f.ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=changed'],
      mode: 'edit',
      mutation: true,
    }, deps);
    const after = await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deps);
    const refresh = await executeOfficeCommand(f.ctx, { argv: ['refresh', file], mode: 'edit' }, deps);

    expect(cached.envelope.cacheHit).toBe(true);
    expect(edit.envelope.artifactRevision).toBeGreaterThan(before.envelope.artifactRevision ?? 0);
    expect(after.envelope.cacheHit).toBe(false);
    expect(refresh.envelope.backend).toBe('libreoffice-native');
    expect(refresh.envelope.warnings.some(warning => /Windows only/i.test(warning.message))).toBe(false);
    expect(commandCalls(calls).filter(call => call.args[0] === 'get')).toHaveLength(2);
  });

  it('releases session-scoped read, failure, and mutation state on session teardown', async () => {
    const f = fixture({ sessionId: 'release-runtime' });
    const file = officeFile(join(f.working, 'release.docx'));
    const { deps, calls } = dependencies();

    await executeOfficeCommand(f.ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=changed'], mode: 'edit', mutation: true,
    }, deps);
    await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deps);
    const cached = await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deps);
    expect(cached.envelope.cacheHit).toBe(true);

    releaseOfficeRuntimeSession(f.ctx.sessionId);
    expect(wasOfficeArtifactMutatedBySession(f.ctx.sessionId, file)).toBe(false);
    const afterRelease = await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deps);

    expect(afterRelease.envelope.cacheHit).toBe(false);
    expect(commandCalls(calls).filter(call => call.args[0] === 'get')).toHaveLength(2);
  });

  it('accepts structured atomic batch input, dump meta, and explicit best effort', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'model.xlsx'));
    const image = officeFile(join(f.working, 'logo.png'));
    const { deps, calls } = dependencies();
    const commands = [
      JSON.stringify({ command: 'meta', dumpVersion: 1 }),
      JSON.stringify({ command: 'add', parent: '/Sheet1', type: 'image', props: { src: image } }),
    ];

    const atomic = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands },
      mode: 'edit',
    }, deps);
    const bestEffort = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file, '--best-effort'],
      batch: { commands: [JSON.stringify({ command: 'get', path: '/Sheet1/A1' })] },
      mode: 'edit',
    }, deps);
    const firstArgs = commandCalls(calls)[0]?.args ?? [];

    expect(atomic.envelope.ok).toBe(true);
    expect(firstArgs).not.toContain('--best-effort');
    expect(firstArgs[firstArgs.indexOf('--commands') + 1])
      .toBe(JSON.stringify(commands.map(command => JSON.parse(command))));
    expect(bestEffort.envelope.ok).toBe(true);
    expect(commandCalls(calls)[1]?.args).toContain('--best-effort');
  });

  it('rejects ambiguous, unknown, management, and escaped batch sources', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'batch.docx'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'selection-office-batch-outside-'));
    roots.push(outsideRoot);
    const outsideImage = officeFile(join(outsideRoot, 'outside.png'));
    const { deps } = dependencies();

    const ambiguous = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: ['{"command":"get","path":"/"}'], file: 'commands.json' },
      mode: 'edit',
    }, deps);
    const unknown = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: ['{"command":"future-write"}'] },
      mode: 'edit',
    }, deps);
    const management = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: ['{"command":"plugins"}'] },
      mode: 'edit',
    }, deps);
    const escaped = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: [JSON.stringify({ command: 'add', props: { src: outsideImage } })] },
      mode: 'edit',
    }, deps);

    expect(ambiguous.envelope.error?.code).toBe('batch_source_required');
    expect(unknown.envelope.error?.code).toBe('forbidden_batch_command');
    expect(management.envelope.error?.code).toBe('forbidden_batch_command');
    expect(escaped.envelope.error?.code).toBe('path_outside_allowed_roots');
  });

  it('uses the pinned nested batch grammar and keeps rendering in preview', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'batch.pptx'));
    const { deps, calls } = dependencies();

    const aliasAccepted = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: [JSON.stringify({ op: 'get', path: '/' })] },
      mode: 'edit',
    }, deps);
    const unsupportedRoot = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: [JSON.stringify({ command: 'merge', path: '/' })] },
      mode: 'edit',
    }, deps);
    const hiddenField = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: [JSON.stringify({ command: 'get', path: '/', browser: true })] },
      mode: 'edit',
    }, deps);
    const render = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: [JSON.stringify({ command: 'view', mode: 'html' })] },
      mode: 'edit',
    }, deps);

    expect(aliasAccepted.envelope.ok).toBe(true);
    expect(unsupportedRoot.envelope.error?.code).toBe('forbidden_batch_command');
    expect(hiddenField.envelope.error?.code).toBe('unknown_batch_field');
    expect(render.envelope.error?.code).toBe('batch_render_requires_preview');
    expect(commandCalls(calls)).toHaveLength(1);
  });

  it('requires Morph 3D model paths to be authorized, existing, and valid GLB files', async () => {
    const f = fixture();
    const deck = officeFile(join(f.working, 'morph.pptx'));
    const valid = join(f.working, 'sun.glb');
    const invalid = officeFile(join(f.working, 'invalid.glb'), 'not a glb file');
    const validHeader = Buffer.alloc(12);
    validHeader.write('glTF', 0, 'ascii');
    validHeader.writeUInt32LE(2, 4);
    validHeader.writeUInt32LE(validHeader.length, 8);
    writeFileSync(valid, validHeader);
    const outsideRoot = mkdtempSync(join(tmpdir(), 'selection-office-glb-outside-'));
    roots.push(outsideRoot);
    const outside = join(outsideRoot, 'outside.glb');
    writeFileSync(outside, validHeader);
    const { deps, calls } = dependencies();

    const accepted = await executeOfficeCommand(f.ctx, {
      argv: ['batch', deck],
      batch: { commands: [JSON.stringify({
        command: 'add', parent: '/slide[1]', type: '3dmodel', props: { path: valid, name: 'sun' },
      })] },
      mode: 'edit',
    }, deps);
    const malformed = await executeOfficeCommand(f.ctx, {
      argv: ['add', deck, '/slide[1]', '--type', '3dmodel', '--prop', `path=${invalid}`],
      mode: 'edit',
    }, deps);
    const escaped = await executeOfficeCommand(f.ctx, {
      argv: ['add', deck, '/slide[1]', '--type', '3dmodel', '--prop', `path=${outside}`],
      mode: 'edit',
    }, deps);
    const remote = await executeOfficeCommand(f.ctx, {
      argv: ['add', deck, '/slide[1]', '--type', '3dmodel', '--prop', 'path=https://example.com/model.glb'],
      mode: 'edit',
    }, deps);

    expect(accepted.envelope.ok).toBe(true);
    expect(malformed.envelope.error?.code).toBe('invalid_morph_glb');
    expect(escaped.envelope.error?.code).toBe('path_outside_allowed_roots');
    expect(remote.envelope.error?.code).toBe('file_not_found');
    expect(commandCalls(calls)).toHaveLength(1);
  });

  it('validates import and merge input files before invoking OfficeCLI', async () => {
    const f = fixture();
    const workbook = officeFile(join(f.working, 'book.xlsx'));
    const template = officeFile(join(f.working, 'template.docx'));
    const { deps } = dependencies();

    const missingCsv = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', 'missing.csv'],
      mode: 'edit',
    }, deps);
    const stdin = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', '--stdin'],
      mode: 'edit',
    }, deps);
    const missingData = await executeOfficeCommand(f.ctx, {
      argv: ['merge', template, 'output.docx', '--data', 'missing.json'],
      mode: 'edit',
    }, deps);
    const inlineData = await executeOfficeCommand(f.ctx, {
      argv: ['merge', template, 'output.docx', '--data', '{"name":"Selection"}'],
      mode: 'edit',
    }, deps);

    expect(missingCsv.envelope.error?.code).toBe('file_not_found');
    expect(stdin.envelope.error?.code).toBe('stdin_not_supported');
    expect(missingData.envelope.error?.code).toBe('file_not_found');
    expect(inlineData.envelope.ok).toBe(true);
  });

  it('reports permission, timeout, and runtime-manifest mismatch as structured errors', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'errors.docx'));

    const deniedDeps = dependencies(() => processResult(
      '{"success":false,"error":{"code":"access_denied","message":"Permission denied"}}',
      { exitCode: 1 },
    )).deps;
    const denied = await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deniedDeps);
    expect(denied.envelope.error).toMatchObject({ category: 'permission', upstreamCode: 'access_denied' });

    clearOfficeRuntimeState();
    const timeoutDeps = dependencies(() => processResult('', { timedOut: true, exitCode: null })).deps;
    const timeout = await executeOfficeCommand(f.ctx, {
      argv: ['get', file, '/'], mode: 'inspect', timeoutMs: 10_000,
    }, timeoutDeps);
    expect(timeout.envelope.error).toMatchObject({ code: 'timeout', category: 'timeout', retriable: true });

    clearOfficeRuntimeState();
    const { deps } = dependencies();
    deps.runProcess = async (_binary, args) => {
      if (args[0] === '--version') return processResult('1.0.999');
      if (args[0] === '--output-schema-crc') return processResult('aaaaaaaa');
      return processResult('{}');
    };
    const mismatch = await executeOfficeCommand(f.ctx, { argv: ['status'], mode: 'inspect' }, deps);
    expect(mismatch.envelope).toMatchObject({
      ok: false,
      error: { code: 'runtime_manifest_mismatch', category: 'dependency' },
      data: { actualVersion: '1.0.999', actualSchemaCrc: 'aaaaaaaa' },
    });
  });

  it('reports an unwritable output ancestor where the platform exposes mode permissions', async () => {
    if (process.platform === 'win32') return;
    const f = fixture();
    const readOnly = join(f.working, 'readonly');
    mkdirSync(readOnly);
    chmodSync(readOnly, 0o555);
    const { deps } = dependencies();
    const result = await executeOfficeCommand(f.ctx, {
      argv: ['create', join(readOnly, 'nested', 'output.docx')],
      mode: 'edit',
    }, deps);
    chmodSync(readOnly, 0o755);
    expect(['output_parent_not_writable', 'output_directory_create_failed'])
      .toContain(result.envelope.error?.code ?? '');
  });
});
