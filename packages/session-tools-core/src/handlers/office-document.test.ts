import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import type { OfficeResultEnvelope } from '../office-types.ts';
import {
  clearOfficeRuntimeState,
  executeOfficeCommand,
  flushOfficeResidentLease,
  releaseOfficeRuntimeSession,
  wasOfficeArtifactMutatedBySession,
  type OfficecliProcessResult,
  type OfficeCoordinatorDependencies,
} from '../runtime/office-coordinator.ts';
import { handleOfficeDocumentEdit, handleOfficeDocumentInspect } from './office-document.ts';
import { clearOfficeGuideCache } from './office-guide.ts';
import { resolveOfficecliResources, reviewedOfficecliSchemaCrc } from '../runtime/office-manifest.ts';

const resources = resolveOfficecliResources({
  explicitRoot: resolve(import.meta.dir, '../../../../apps/electron/resources/officecli'),
});
if (!resources) throw new Error('OfficeCLI test resources are missing');
const expectedRuntimeSha256 = resources.manifest.assets[`${process.platform}-${process.arch}`]?.sha256;
if (!expectedRuntimeSha256) throw new Error(`OfficeCLI test asset is missing for ${process.platform}-${process.arch}`);
const expectedSchemaCrc = reviewedOfficecliSchemaCrc(resources.manifest);

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
        if (args.length === 1 && args[0] === '--output-schema-crc') return processResult(`${expectedSchemaCrc}\n`);
        return execute(args);
      },
    },
  };
}

function envelope(result: Awaited<ReturnType<typeof executeOfficeCommand>>): OfficeResultEnvelope {
  return result.envelope;
}

function commandCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter(call => !['--version', '--output-schema-crc', 'open', 'save', 'close'].includes(call.args[0] ?? ''));
}

function lifecycleCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter(call => ['open', 'save', 'close'].includes(call.args[0] ?? ''));
}

beforeEach(() => {
  clearOfficeRuntimeState();
  clearOfficeGuideCache();
});

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
      schemaCrc: expectedSchemaCrc,
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
      NO_COLOR: '1',
    });
    expect(commandCalls(calls)[0]?.env?.OFFICECLI_NO_AUTO_RESIDENT).toBeUndefined();
    expect(lifecycleCalls(calls)[0]?.args).toEqual(['open', realpathSync.native(file), '--json']);
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
      { argv: ['dump', file, '/', '--out', 'dump.json'], mode: 'inspect' as const, code: 'inspect_artifact_outside_office_dir' },
    ];

    for (const testCase of cases) {
      const result = await executeOfficeCommand(f.ctx, testCase, deps);
      expect(result.envelope.error?.code).toBe(testCase.code);
    }
    expect(calls).toHaveLength(0);
  });

  it('points forbidden OfficeCLI commands at the matching five tools', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'report.docx'));
    const { deps } = dependencies();

    const loadSkill = await executeOfficeCommand(f.ctx, { argv: ['load_skill', 'word'], mode: 'inspect' }, deps);
    const open = await executeOfficeCommand(f.ctx, { argv: ['open', file], mode: 'edit' }, deps);

    expect(loadSkill.envelope.error).toMatchObject({
      code: 'management_command_forbidden',
      recovery: expect.stringContaining('office_document_guide'),
    });
    expect(open.envelope.error).toMatchObject({
      code: 'management_command_forbidden',
      recovery: expect.stringContaining('office_document_inspect'),
    });
  });

  it('rejects non-native command casing and whitespace before policy or path handling', async () => {
    const f = fixture();
    const output = join(f.working, 'wrongly-normalized.docx');
    const { deps, calls } = dependencies();

    const uppercase = await executeOfficeCommand(f.ctx, {
      argv: ['Create', output],
      mode: 'edit',
    }, deps);
    const padded = await executeOfficeCommand(f.ctx, {
      argv: [' create ', output],
      mode: 'edit',
    }, deps);
    const prefixed = await executeOfficeCommand(f.ctx, {
      argv: [' OfficeCLI ', 'create', output],
      mode: 'edit',
    }, deps);

    expect(uppercase.envelope.error?.code).toBe('invalid_command_token');
    expect(padded.envelope.error?.code).toBe('invalid_command_token');
    expect(prefixed.envelope.error?.code).toBe('binary_prefix_forbidden');
    expect(existsSync(output)).toBe(false);
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
    const directoryTarget = join(f.working, 'directory.docx');
    mkdirSync(directoryTarget);
    const { deps, calls } = dependencies();

    const created = await executeOfficeCommand(f.ctx, { argv: ['create', output], mode: 'edit' }, deps);
    const refused = await executeOfficeCommand(f.ctx, { argv: ['create', existing], mode: 'edit' }, deps);
    const forced = await executeOfficeCommand(f.ctx, { argv: ['create', existing, '--force'], mode: 'edit' }, deps);
    const forcedDirectory = await executeOfficeCommand(f.ctx, {
      argv: ['create', directoryTarget, '--force'], mode: 'edit',
    }, deps);

    expect(created.envelope.ok).toBe(true);
    expect(existsSync(dirname(output))).toBe(true);
    expect(refused.envelope.error?.code).toBe('output_exists');
    expect(forced.envelope.ok).toBe(true);
    expect(forcedDirectory.envelope.error?.code).toBe('output_target_not_file');
    expect(commandCalls(calls).map(call => call.args)).toContainEqual(['create', existing, '--force', '--json']);
  });

  it('normalizes typed create outputs before authorization and rejects ambiguous or corrupting document paths', async () => {
    const f = fixture();
    const outsideRoot = mkdtempSync(join(tmpdir(), 'selection-office-create-outside-'));
    roots.push(outsideRoot);
    const { deps, calls } = dependencies();
    const requested = join(f.working, 'typed-output');

    const created = await executeOfficeCommand(f.ctx, {
      argv: ['create', requested, '--type', 'docx'],
      mode: 'edit',
    }, deps);
    const escaped = await executeOfficeCommand(f.ctx, {
      argv: ['create', join(outsideRoot, 'escaped'), '--type', 'pptx'],
      mode: 'edit',
    }, deps);
    const mismatchedCreate = await executeOfficeCommand(f.ctx, {
      argv: ['create', join(f.working, 'wrong.docx'), '--type', 'pptx'],
      mode: 'edit',
    }, deps);
    const template = officeFile(join(f.working, 'template.docx'));
    const mismatchedMerge = await executeOfficeCommand(f.ctx, {
      argv: ['merge', template, join(f.working, 'corrupt.xlsx'), '--data', '{}'],
      mode: 'edit',
    }, deps);
    const inPlaceMerge = await executeOfficeCommand(f.ctx, {
      argv: ['merge', template, template, '--data', '{}', '--force'],
      mode: 'edit',
    }, deps);
    const hardlinkedTemplate = join(f.working, 'template-alias.docx');
    linkSync(template, hardlinkedTemplate);
    const hardlinkMerge = await executeOfficeCommand(f.ctx, {
      argv: ['merge', template, hardlinkedTemplate, '--data', '{}', '--force'],
      mode: 'edit',
    }, deps);

    expect(created.envelope).toMatchObject({
      ok: true,
      documentPath: join(realpathSync.native(f.working), 'typed-output.docx'),
      artifactRevision: 1,
    });
    expect(commandCalls(calls)[0]?.args).toEqual(['create', `${requested}.docx`, '--type', 'docx', '--json']);
    expect(escaped.envelope.error).toMatchObject({ code: 'path_outside_allowed_roots', category: 'permission' });
    expect(mismatchedCreate.envelope.error?.code).toBe('document_type_mismatch');
    expect(mismatchedMerge.envelope.error?.code).toBe('document_type_mismatch');
    expect(inPlaceMerge.envelope.error?.code).toBe('output_conflicts_with_input');
    expect(hardlinkMerge.envelope.error?.code).toBe('output_conflicts_with_input');
    expect(commandCalls(calls)).toHaveLength(1);
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

  it('does not count timeout or dependency failures toward loop_prevented', async () => {
    const f = fixture();
    const timeoutFile = officeFile(join(f.working, 'timeout-loop.docx'));
    const dependencyFile = officeFile(join(f.working, 'dependency-loop.docx'));
    const timeoutDeps = dependencies(() => processResult('', { timedOut: true, exitCode: null }));
    const dependencyDeps = dependencies(() => processResult(
      '{"success":false,"error":{"code":"native_unavailable","message":"Native renderer unavailable"}}',
      { exitCode: 1 },
    ));

    const timeouts = [];
    const dependenciesFailed = [];
    for (let index = 0; index < 4; index += 1) {
      timeouts.push(await executeOfficeCommand(f.ctx, {
        argv: ['get', timeoutFile, '/'],
        mode: 'inspect',
      }, timeoutDeps.deps));
      dependenciesFailed.push(await executeOfficeCommand(f.ctx, {
        argv: ['get', dependencyFile, '/'],
        mode: 'inspect',
      }, dependencyDeps.deps));
    }

    expect(timeouts.map(result => result.envelope.error?.code)).toEqual([
      'timeout', 'timeout', 'timeout', 'timeout',
    ]);
    expect(dependenciesFailed.map(result => result.envelope.error?.code)).toEqual([
      'dependency_unavailable', 'dependency_unavailable', 'dependency_unavailable', 'dependency_unavailable',
    ]);
    expect(commandCalls(timeoutDeps.calls).filter(call => call.args[0] === 'get').length).toBeGreaterThanOrEqual(4);
    expect(commandCalls(dependencyDeps.calls).filter(call => call.args[0] === 'get').length).toBeGreaterThanOrEqual(4);
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
    const escapedBatchFile = join(f.working, 'escaped-batch.json');
    writeFileSync(escapedBatchFile, JSON.stringify([{
      command: 'add', parent: '/body', type: 'picture', props: { src: outsideImage },
    }]));
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
    const ambiguousVerb = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: ['{"command":"get","op":"add","parent":"/body","type":"p"}'] },
      mode: 'edit',
    }, deps);
    const escaped = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: [JSON.stringify({
        command: 'add', parent: '/body', type: 'picture', props: { src: outsideImage },
      })] },
      mode: 'edit',
    }, deps);
    const escapedFromFile = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { file: escapedBatchFile },
      mode: 'edit',
    }, deps);
    const escapedWithUpstreamCasing = await executeOfficeCommand(f.ctx, {
      argv: ['batch', file],
      batch: { commands: [JSON.stringify({
        Command: 'add', Parent: '/body', Type: 'picture', Props: { src: outsideImage },
      })] },
      mode: 'edit',
    }, deps);

    expect(ambiguous.envelope.error?.code).toBe('batch_source_required');
    expect(unknown.envelope.error?.code).toBe('forbidden_batch_command');
    expect(management.envelope.error?.code).toBe('forbidden_batch_command');
    expect(ambiguousVerb.envelope.error?.code).toBe('ambiguous_batch_command');
    expect(escaped.envelope.error?.code).toBe('path_outside_allowed_roots');
    expect(escapedFromFile.envelope.error?.code).toBe('path_outside_allowed_roots');
    expect(escapedWithUpstreamCasing.envelope.error?.code).toBe('path_outside_allowed_roots');
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

  it('authorizes every native property that can read a local resource without misclassifying semantic values', async () => {
    const f = fixture();
    const document = officeFile(join(f.working, 'resources.docx'));
    const workbook = officeFile(join(f.working, 'resources.xlsx'));
    const deck = officeFile(join(f.working, 'resources.pptx'));
    const insideMarkdown = officeFile(join(f.working, 'inside.md'), '# Inside');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'selection-office-resource-outside-'));
    roots.push(outsideRoot);
    const outsideMarkdown = officeFile(join(outsideRoot, 'secret.md'), '# Secret');
    const outsideImage = officeFile(join(outsideRoot, 'secret.png'));
    const outsideCsv = officeFile(join(outsideRoot, 'secret.csv'), 'name,value\nsecret,1');
    const { deps, calls } = dependencies();

    const markdown = await executeOfficeCommand(f.ctx, {
      argv: ['add', document, '/body', '--type', 'markdown', '--prop', `path=${outsideMarkdown}`],
      mode: 'edit',
    }, deps);
    const pictureFallback = await executeOfficeCommand(f.ctx, {
      argv: [
        'add', document, '/body', '--type', 'picture',
        '--prop', `src=${insideMarkdown}`, '--prop', `fallback=${outsideImage}`,
      ],
      mode: 'edit',
    }, deps);
    const tableCsv = await executeOfficeCommand(f.ctx, {
      argv: ['add', document, '/body', '--type', 'table', '--prop', `data=${outsideCsv}`],
      mode: 'edit',
    }, deps);
    const background = await executeOfficeCommand(f.ctx, {
      argv: ['set', deck, '/slide[1]', '--prop', `background=image:${outsideImage}`],
      mode: 'edit',
    }, deps);
    const batchOleIcon = await executeOfficeCommand(f.ctx, {
      argv: ['batch', deck],
      batch: { commands: [JSON.stringify({
        command: 'add', parent: '/slide[1]', type: 'ole',
        props: { src: insideMarkdown, icon: outsideImage },
      })] },
      mode: 'edit',
    }, deps);

    // These are native semantic values, not filesystem inputs. The previous
    // name-only validator rejected all three before OfficeCLI could run them.
    const pivotSource = await executeOfficeCommand(f.ctx, {
      argv: ['add', workbook, '/Sheet1', '--type', 'pivottable', '--prop', 'src=Sheet1!A1:D10'],
      mode: 'edit',
    }, deps);
    const pivotSourceUpdate = await executeOfficeCommand(f.ctx, {
      argv: ['set', workbook, '/Sheet1/pivottable[1]', '--prop', 'src=Sheet1!A1:E20'],
      mode: 'edit',
    }, deps);
    const batchPivotSourceUpdate = await executeOfficeCommand(f.ctx, {
      argv: ['batch', workbook],
      batch: { commands: [JSON.stringify({
        command: 'set', path: '/Sheet1/pivottable[1]', props: { src: 'Sheet1!A1:F30' },
      })] },
      mode: 'edit',
    }, deps);
    const diagramPoster = await executeOfficeCommand(f.ctx, {
      argv: [
        'add', deck, '/slide[1]', '--type', 'diagram',
        '--prop', 'mermaid=flowchart LR; A-->B', '--prop', 'poster=true',
      ],
      mode: 'edit',
    }, deps);
    const clearImageFill = await executeOfficeCommand(f.ctx, {
      argv: ['set', deck, '/slide[1]/shape[1]', '--prop', 'image=none'],
      mode: 'edit',
    }, deps);
    const motionPath = await executeOfficeCommand(f.ctx, {
      argv: ['set', deck, '/slide[1]/shape[1]/animation[1]', '--prop', 'path=line'],
      mode: 'edit',
    }, deps);
    const batchMotionPath = await executeOfficeCommand(f.ctx, {
      argv: ['batch', deck],
      batch: { commands: [JSON.stringify({
        command: 'set', path: '/slide[1]/shape[1]/animation[1]', props: { path: 'custom', d: 'M 0 0 L 0.5 0 E' },
      })] },
      mode: 'edit',
    }, deps);

    const escapedSetInputs = await Promise.all([
      executeOfficeCommand(f.ctx, {
        argv: ['set', document, '/body/p[1]/r[1]', '--prop', `src=${outsideImage}`],
        mode: 'edit',
      }, deps),
      executeOfficeCommand(f.ctx, {
        argv: ['set', workbook, '/Sheet1/ole[1]', '--prop', `path=${outsideMarkdown}`],
        mode: 'edit',
      }, deps),
      executeOfficeCommand(f.ctx, {
        argv: ['set', workbook, '/Sheet1/A1', '--prop', `image=${outsideImage}`],
        mode: 'edit',
      }, deps),
      executeOfficeCommand(f.ctx, {
        argv: ['set', deck, '/slide[1]/picture[1]', '--prop', `src=${outsideImage}`],
        mode: 'edit',
      }, deps),
      executeOfficeCommand(f.ctx, {
        argv: ['set', deck, '/slide[1]/video[1]', '--prop', `poster=${outsideImage}`],
        mode: 'edit',
      }, deps),
      executeOfficeCommand(f.ctx, {
        argv: ['set', deck, '/slide[1]/zoom[1]', '--prop', `cover=${outsideImage}`],
        mode: 'edit',
      }, deps),
      executeOfficeCommand(f.ctx, {
        argv: ['set', deck, '/slide[1]/shape[1]', '--prop', `imagefill=${outsideImage}`],
        mode: 'edit',
      }, deps),
    ]);

    for (const rejected of [markdown, pictureFallback, tableCsv, background, batchOleIcon]) {
      expect(rejected.envelope.error).toMatchObject({
        code: 'path_outside_allowed_roots',
        category: 'permission',
      });
    }
    expect(pivotSource.envelope.ok).toBe(true);
    expect(pivotSourceUpdate.envelope.ok).toBe(true);
    expect(batchPivotSourceUpdate.envelope.ok).toBe(true);
    expect(diagramPoster.envelope.ok).toBe(true);
    expect(clearImageFill.envelope.ok).toBe(true);
    expect(motionPath.envelope.ok).toBe(true);
    expect(batchMotionPath.envelope.ok).toBe(true);
    for (const rejected of escapedSetInputs) {
      expect(rejected.envelope.error).toMatchObject({
        code: 'path_outside_allowed_roots',
        category: 'permission',
      });
    }
    expect(commandCalls(calls)).toHaveLength(7);
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
    const aliasAccepted = await executeOfficeCommand(f.ctx, {
      argv: ['add', deck, '/slide[1]', '--type', 'model3d', '--prop', `src=${valid}`],
      mode: 'edit',
    }, deps);
    const malformed = await executeOfficeCommand(f.ctx, {
      argv: ['add', deck, '/slide[1]', '--type', 'model', '--prop', `path=${invalid}`],
      mode: 'edit',
    }, deps);
    const escaped = await executeOfficeCommand(f.ctx, {
      argv: ['add', deck, '/slide[1]', '--type', 'glb', '--prop', `src=${outside}`],
      mode: 'edit',
    }, deps);
    const remote = await executeOfficeCommand(f.ctx, {
      argv: ['add', deck, '/slide[1]', '--type', '3dmodel', '--prop', 'path=https://example.com/model.glb'],
      mode: 'edit',
    }, deps);

    expect(accepted.envelope.ok).toBe(true);
    expect(aliasAccepted.envelope.ok).toBe(true);
    expect(malformed.envelope.error?.code).toBe('invalid_morph_glb');
    expect(escaped.envelope.error?.code).toBe('path_outside_allowed_roots');
    expect(remote.envelope.error?.code).toBe('remote_morph_glb_forbidden');
    expect(commandCalls(calls)).toHaveLength(2);
  });

  it('validates import and merge input files before invoking OfficeCLI', async () => {
    const f = fixture();
    const workbook = officeFile(join(f.working, 'book.xlsx'));
    const document = officeFile(join(f.working, 'book.docx'));
    const csv = officeFile(join(f.working, 'data.csv'), 'name,value\nSelection,1\n');
    const template = officeFile(join(f.working, 'template.docx'));
    const missingDataOutput = join(f.working, 'must-not-exist', 'output.docx');
    const { deps } = dependencies();

    const missingCsv = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', 'missing.csv'],
      mode: 'edit',
    }, deps);
    const stdin = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', '--stdin'],
      mode: 'edit',
    }, deps);
    const ambiguousSource = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', csv, '--file', csv],
      mode: 'edit',
    }, deps);
    const invalidFormat = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', csv, '--format', 'xml'],
      mode: 'edit',
    }, deps);
    const invalidStartCell = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', csv, '--start-cell', 'XFE1'],
      mode: 'edit',
    }, deps);
    const unknownArgument = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', csv, '--unknown', 'ignored'],
      mode: 'edit',
    }, deps);
    const wrongTarget = await executeOfficeCommand(f.ctx, {
      argv: ['import', document, '/Sheet1', csv],
      mode: 'edit',
    }, deps);
    const missingData = await executeOfficeCommand(f.ctx, {
      argv: ['merge', template, missingDataOutput, '--data', 'missing.json'],
      mode: 'edit',
    }, deps);
    const inlineData = await executeOfficeCommand(f.ctx, {
      argv: ['merge', template, 'output.docx', '--data', '{"name":"Selection"}'],
      mode: 'edit',
    }, deps);

    expect(missingCsv.envelope.error?.code).toBe('file_not_found');
    expect(stdin.envelope.error?.code).toBe('stdin_not_supported');
    expect(ambiguousSource.envelope.error?.code).toBe('ambiguous_import_source');
    expect(invalidFormat.envelope.error?.code).toBe('invalid_import_format');
    expect(invalidStartCell.envelope.error?.code).toBe('invalid_import_start_cell');
    expect(unknownArgument.envelope.error?.code).toBe('invalid_import_argument');
    expect(wrongTarget.envelope.error?.code).toBe('import_requires_xlsx');
    expect(missingData.envelope.error?.code).toBe('file_not_found');
    expect(existsSync(dirname(missingDataOutput))).toBe(false);
    expect(inlineData.envelope.ok).toBe(true);
  });

  it('recovers a manifest-reviewed false-success import through one atomic OfficeCLI batch', async () => {
    const f = fixture();
    const workbook = officeFile(join(f.working, 'import.xlsx'));
    const csv = officeFile(
      join(f.working, 'quoted data.csv'),
      '\uFEFF季度,"收入,净额"\r\nQ1,42000\r\nQ2,45000\r\n',
    );
    let recipePath: string | undefined;
    let recipe: Array<Record<string, unknown>> = [];
    const { deps, calls } = dependencies(args => {
      if (args[0] === 'open' || args[0] === 'save' || args[0] === 'close') {
        return processResult('{"success":true}');
      }
      if (args[0] === 'import') {
        return processResult('{"success":true,"data":{"imported":true}}');
      }
      if (args[0] === 'get') {
        return processResult('{"success":true,"data":{"path":"/Sheet1/B2","children":[]}}');
      }
      expect(args[0]).toBe('batch');
      recipePath = args[args.indexOf('--input') + 1];
      recipe = JSON.parse(readFileSync(recipePath!, 'utf8')) as Array<Record<string, unknown>>;
      writeFileSync(workbook, 'mutated-by-officecli-batch');
      return processResult(JSON.stringify({
        success: true,
        data: { summary: { total: recipe.length, succeeded: recipe.length, failed: 0 } },
      }));
    });

    const result = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', '--header', '--start-cell', 'B2', csv],
      mode: 'edit',
    }, deps);

    expect(result.envelope).toMatchObject({
      ok: true,
      backend: 'officecli-batch-recipe',
      artifactRevision: 2,
      data: {
        import: { rows: 3, columns: 2, startCell: 'B2', header: true },
      },
      warnings: [expect.objectContaining({ code: 'reviewed_import_recipe_applied' })],
    });
    expect(result.envelope.command[0]).toBe('batch');
    expect(recipe).toEqual([
      { command: 'set', path: '/Sheet1/B2', props: { value: '季度' } },
      { command: 'set', path: '/Sheet1/C2', props: { value: '收入,净额' } },
      { command: 'set', path: '/Sheet1/B3', props: { value: 'Q1' } },
      { command: 'set', path: '/Sheet1/C3', props: { value: '42000' } },
      { command: 'set', path: '/Sheet1/B4', props: { value: 'Q2' } },
      { command: 'set', path: '/Sheet1/C4', props: { value: '45000' } },
      { command: 'set', path: '/Sheet1', props: { freeze: 'A3', autoFilter: 'B2:C4' } },
    ]);
    expect(recipePath).toBeDefined();
    expect(existsSync(recipePath!)).toBe(false);
    expect(commandCalls(calls).map(call => call.args[0])).toEqual(['import', 'get', 'batch']);
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

  it('keeps agent lifecycle argv forbidden while the lease channel can save', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'lease.docx'));
    const { deps, calls } = dependencies();

    const agent = await executeOfficeCommand(f.ctx, { argv: ['save', file], mode: 'edit' }, deps);
    const lease = await executeOfficeCommand(f.ctx, {
      argv: ['save', file],
      mode: 'internal',
      allowLifecycle: true,
    }, deps);

    expect(agent.envelope.error?.code).toBe('management_command_forbidden');
    expect(lease.envelope.ok).toBe(true);
    expect(lifecycleCalls(calls).some(call => call.args[0] === 'save')).toBe(true);
  });

  it('does not treat a resident save rewrite as a new artifact revision', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'save-revision.docx'));
    const { deps } = dependencies(args => {
      if (args[0] === 'save') writeFileSync(file, readFileSync(file));
      return processResult('{"success":true,"data":{"ok":true}}');
    });

    const before = await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deps);
    const edit = await executeOfficeCommand(f.ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=changed'],
      mode: 'edit',
      mutation: true,
    }, deps);
    const saved = await executeOfficeCommand(f.ctx, {
      argv: ['save', file],
      mode: 'internal',
      allowLifecycle: true,
    }, deps);

    expect(edit.envelope.artifactRevision).toBeGreaterThan(before.envelope.artifactRevision ?? 0);
    expect(saved.envelope.artifactRevision).toBe(edit.envelope.artifactRevision);
  });

  it('retries once without resident after a file_busy failure', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'busy.docx'));
    let gets = 0;
    const { deps, calls } = dependencies(args => {
      if (args[0] === 'get') {
        gets += 1;
        if (gets === 1) {
          return processResult(
            '{"success":false,"error":{"code":"file_busy","message":"Workbook is locked"}}',
            { exitCode: 1 },
          );
        }
      }
      return processResult('{"success":true,"data":{"ok":true}}');
    });

    const result = await executeOfficeCommand(f.ctx, { argv: ['get', file, '/'], mode: 'inspect' }, deps);

    expect(result.envelope.ok).toBe(true);
    const getsCalls = commandCalls(calls).filter(call => call.args[0] === 'get');
    expect(getsCalls).toHaveLength(2);
    expect(getsCalls[1]?.env?.OFFICECLI_NO_AUTO_RESIDENT).toBe('1');
    expect(lifecycleCalls(calls).some(call => call.args[0] === 'close')).toBe(true);
  });

  it('does not retry a timed-out mutation, to avoid applying it twice', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'timeout.docx'));
    const { deps, calls } = dependencies(args => {
      if (args[0] === 'set') return processResult('', { timedOut: true, exitCode: null });
      return processResult('{"success":true}');
    });

    const result = await executeOfficeCommand(f.ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=once'],
      mode: 'edit',
      mutation: true,
    }, deps);

    expect(result.envelope.error?.code).toBe('timeout');
    expect(commandCalls(calls).filter(call => call.args[0] === 'set')).toHaveLength(1);
  });

  it('opens a document once per session and closes the lease on release', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'hot.docx'));
    const { deps, calls } = dependencies();

    await executeOfficeCommand(f.ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=one'],
      mode: 'edit',
      mutation: true,
    }, deps);
    await executeOfficeCommand(f.ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=two'],
      mode: 'edit',
      mutation: true,
    }, deps);

    expect(lifecycleCalls(calls).filter(call => call.args[0] === 'open')).toHaveLength(1);
    await releaseOfficeRuntimeSession(f.ctx.sessionId);
    expect(lifecycleCalls(calls).filter(call => call.args[0] === 'close')).toHaveLength(1);
  });

  it('flushes the resident lease before inspect html artifacts', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'preview.docx'));
    const { deps, calls } = dependencies();

    await executeOfficeCommand(f.ctx, {
      argv: ['set', file, '/body/p[1]', '--prop', 'text=draft'],
      mode: 'edit',
      mutation: true,
    }, deps);
    await flushOfficeResidentLease(f.ctx, file, deps);
    const html = await executeOfficeCommand(f.ctx, {
      argv: ['view', file, 'html'],
      mode: 'inspect',
    }, deps);

    expect(html.envelope.ok).toBe(true);
    expect(lifecycleCalls(calls).some(call => call.args[0] === 'save')).toBe(true);
    expect(html.envelope.command).toContain('--out');
    expect(String(html.envelope.command[html.envelope.command.indexOf('--out') + 1])).toContain(join('data', 'office'));

    const relative = await flushOfficeResidentLease(f.ctx, basename(file), deps);
    expect(relative?.envelope.ok).toBe(true);
    expect(lifecycleCalls(calls).filter(call => call.args[0] === 'save').length).toBeGreaterThan(1);
  });

  it('uses native import when the probe finds persisted cells', async () => {
    const f = fixture();
    const workbook = officeFile(join(f.working, 'native.xlsx'));
    const csv = officeFile(join(f.working, 'native.csv'), '季度,收入\nQ1,1\n');
    const { deps, calls } = dependencies(args => {
      if (args[0] === 'get') {
        return processResult(JSON.stringify({ success: true, data: { value: '季度' } }));
      }
      return processResult('{"success":true,"data":{"imported":true}}');
    });

    const result = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', '--header', csv],
      mode: 'edit',
    }, deps);

    expect(result.envelope).toMatchObject({ ok: true, backend: 'officecli' });
    expect(commandCalls(calls).map(call => call.args[0])).toEqual(['import', 'get']);
  });

  it('does not treat get path metadata as persisted import content', async () => {
    const f = fixture();
    const workbook = officeFile(join(f.working, 'false-positive.xlsx'));
    const csv = officeFile(join(f.working, 'path-header.csv'), 'path,value\nfoo,1\n');
    const { deps, calls } = dependencies(args => {
      if (args[0] === 'get') {
        return processResult(JSON.stringify({ success: true, data: { path: '/Sheet1/A1', children: [] } }));
      }
      if (args[0] === 'batch') return processResult('{"success":true,"data":{"ok":true}}');
      return processResult('{"success":true,"data":{"imported":true}}');
    });

    const result = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', '--header', csv],
      mode: 'edit',
    }, deps);

    expect(result.envelope.backend).toBe('officecli-batch-recipe');
    expect(commandCalls(calls).map(call => call.args[0])).toEqual(['import', 'get', 'batch']);
  });

  it('imports JSON object arrays through the reviewed recipe when native is empty', async () => {
    const f = fixture();
    const workbook = officeFile(join(f.working, 'json.xlsx'));
    const json = officeFile(
      join(f.working, 'rows.json'),
      JSON.stringify([{ 季度: 'Q1', 收入: 42 }, { 季度: 'Q2', 收入: 45 }]),
    );
    let recipe: Array<Record<string, unknown>> = [];
    const { deps } = dependencies(args => {
      if (args[0] === 'get') return processResult('{"success":true,"data":{"children":[]}}');
      if (args[0] === 'batch') {
        recipe = JSON.parse(readFileSync(args[args.indexOf('--input') + 1]!, 'utf8')) as Array<Record<string, unknown>>;
      }
      return processResult('{"success":true,"data":{"ok":true}}');
    });

    const result = await executeOfficeCommand(f.ctx, {
      argv: ['import', workbook, '/Sheet1', '--header', '--format', 'json', json],
      mode: 'edit',
    }, deps);

    expect(result.envelope).toMatchObject({
      ok: true,
      backend: 'officecli-batch-recipe',
      data: { import: { format: 'json', rows: 3, columns: 2, header: true } },
    });
    expect(recipe[0]).toEqual({ command: 'set', path: '/Sheet1/A1', props: { value: '季度' } });
    expect(recipe.at(-1)).toMatchObject({ command: 'set', path: '/Sheet1', props: { freeze: 'A2' } });
  });

  it('writes dump/view html under data/office and still blocks screenshot', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'artifacts.docx'));
    const { deps } = dependencies();
    const dump = await executeOfficeCommand(f.ctx, { argv: ['dump', file, '/'], mode: 'inspect' }, deps);
    const html = await executeOfficeCommand(f.ctx, { argv: ['view', file, 'html'], mode: 'inspect' }, deps);
    const screenshot = await executeOfficeCommand(f.ctx, {
      argv: ['view', file, 'screenshot'],
      mode: 'inspect',
    }, deps);
    const escaped = await executeOfficeCommand(f.ctx, {
      argv: ['dump', file, '/', '--out', join(f.working, 'outside.json')],
      mode: 'inspect',
    }, deps);

    expect(dump.envelope.ok).toBe(true);
    expect(String(dump.envelope.command[dump.envelope.command.indexOf('--out') + 1])).toContain(join('data', 'office'));
    expect(html.envelope.ok).toBe(true);
    expect(screenshot.envelope.error?.code).toBe('render_requires_preview');
    expect(escaped.envelope.error?.code).toBe('inspect_artifact_outside_office_dir');
  });

  it('attaches a skill bootstrap on first create and marks later creates alreadyLoaded', async () => {
    const f = fixture();
    const firstFile = join(f.working, 'bootstrap.docx');
    const secondFile = join(f.working, 'second.docx');
    const { deps } = dependencies(args => {
      if (args[0] === 'create' && typeof args[1] === 'string') {
        mkdirSync(dirname(args[1]), { recursive: true });
        writeFileSync(args[1], 'PK\u0003\u0004');
      }
      return processResult('{"success":true,"data":{"created":true}}');
    });

    const first = await handleOfficeDocumentEdit(f.ctx, { argv: ['create', firstFile] }, deps);
    const second = await handleOfficeDocumentEdit(f.ctx, { argv: ['create', secondFile] }, deps);
    const firstData = (first.structuredContent as OfficeResultEnvelope).data as Record<string, unknown>;
    const secondData = (second.structuredContent as OfficeResultEnvelope).data as Record<string, unknown>;

    expect(first.isError).toBe(false);
    expect(firstData.skillBootstrap).toEqual(expect.objectContaining({
      guide: 'word',
      content: expect.stringContaining('Requirements for Outputs'),
    }));
    expect(String((firstData.skillBootstrap as { content?: string }).content)).toContain('Delivery Gate');
    expect(secondData.skillBootstrap).toEqual({ alreadyLoaded: true, guide: 'word' });
  });

  it('expands edit.recipe.clone into an atomic morph batch', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'morph.pptx'));
    const { deps, calls } = dependencies();

    const result = await handleOfficeDocumentEdit(f.ctx, {
      recipe: { name: 'clone', file, fromSlide: 1, toSlide: 2 },
    }, deps);

    expect(result.isError).toBe(false);
    const batch = commandCalls(calls).find(call => call.args[0] === 'batch');
    expect(JSON.parse(String(batch?.args[(batch?.args.indexOf('--commands') ?? -1) + 1]))).toEqual([
      { command: 'add', parent: '/', from: '/slide[1]' },
      { command: 'set', path: '/slide[2]', props: { transition: 'morph' } },
    ]);
  });

  it('runs inspect.recipe.verify against slide get JSON', async () => {
    const f = fixture();
    const file = officeFile(join(f.working, 'verify.pptx'));
    const { deps } = dependencies(args => {
      if (args[0] === 'get' && String(args[2]).includes('slide[2]')) {
        return processResult(JSON.stringify({
          success: true,
          data: { type: 'slide', format: { transition: 'morph' }, children: [] },
        }));
      }
      return processResult(JSON.stringify({
        success: true,
        data: { type: 'slide', format: { transition: 'fade' }, children: [] },
      }));
    });

    const result = await handleOfficeDocumentInspect(f.ctx, {
      recipe: { name: 'verify', file, slide: 2 },
    }, deps);
    const payload = result.structuredContent as OfficeResultEnvelope;

    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      recipe: 'verify',
      verification: { ok: true },
    });
  });
});
