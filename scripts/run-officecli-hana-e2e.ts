#!/usr/bin/env bun
/**
 * Real Selection headless E2E for the HanaAgent Word regression.
 *
 * Required environment:
 *   CRAFT_CONFIG_DIR       isolated Selection config containing an authenticated connection
 *   OFFICECLI_HANA_SOURCE  path to the original pasted HanaAgent text fixture
 *
 * Optional environment:
 *   OFFICECLI_HANA_MODEL       default pi/MiniMax-M3
 *   OFFICECLI_HANA_CONNECTION  default pi-api-key
 *   OFFICECLI_HANA_TIMEOUT_MS  default 300000
 *   OFFICECLI_HANA_WORKSPACE   keep/use this workspace instead of a temporary one
 *   OFFICECLI_HANA_KEEP=1      preserve a temporary workspace for manual inspection
 *   OFFICECLI_HANA_RESULT      persisted JSON result path (defaults under benchmarks/officecli)
 *
 * The JSON result deliberately contains no prompt, document text, command text,
 * credentials, or full paths.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { WsRpcClient } from '@craft-agent/server-core/transport';
import { RPC_CHANNELS, type SessionEvent } from '@craft-agent/shared/protocol';
import type { OfficecliTaskUsage } from '@craft-agent/shared/sessions';
import { resolveOfficecliBinary } from '@craft-agent/shared/utils';
import { inspectOfficecliAttribution, parseOfficecliJson, runOfficecli } from '@craft-agent/session-tools-core';

const repoRoot = resolve(import.meta.dir, '..');
const CANONICAL_HANA_SOURCE_SHA256 = '668cc1c8a24760c5bb6c096d433da8f4049a88f693cf011397fe52d60c2649aa';
const CANONICAL_HANA_MODEL = 'pi/MiniMax-M3';
const CANONICAL_HANA_CONNECTION = 'pi-api-key';
const sourcePath = process.env.OFFICECLI_HANA_SOURCE
  ? resolve(process.env.OFFICECLI_HANA_SOURCE)
  : '';
const configDir = process.env.CRAFT_CONFIG_DIR
  ? resolve(process.env.CRAFT_CONFIG_DIR)
  : '';
const model = process.env.OFFICECLI_HANA_MODEL ?? CANONICAL_HANA_MODEL;
const connection = process.env.OFFICECLI_HANA_CONNECTION ?? CANONICAL_HANA_CONNECTION;
const timeoutMs = Number(process.env.OFFICECLI_HANA_TIMEOUT_MS ?? 300_000);
const keepWorkspace = process.env.OFFICECLI_HANA_KEEP === '1' || Boolean(process.env.OFFICECLI_HANA_WORKSPACE);
const resultPath = resolve(process.env.OFFICECLI_HANA_RESULT ?? join(repoRoot, 'benchmarks/officecli/hana-minimax-m3-regression.json'));

if (!sourcePath || !existsSync(sourcePath)) throw new Error('OFFICECLI_HANA_SOURCE must identify the original text fixture.');
if (!configDir || !existsSync(join(configDir, 'config.json'))) throw new Error('CRAFT_CONFIG_DIR must identify an isolated Selection config.');
if (!Number.isFinite(timeoutMs) || timeoutMs < 30_000) throw new Error('OFFICECLI_HANA_TIMEOUT_MS must be at least 30000.');
if (model !== CANONICAL_HANA_MODEL || connection !== CANONICAL_HANA_CONNECTION) {
  throw new Error(`Canonical Hana regression requires ${CANONICAL_HANA_MODEL} on ${CANONICAL_HANA_CONNECTION}.`);
}

const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')) as {
  llmConnections?: Array<{
    slug?: string;
    providerType?: string;
    piAuthProvider?: string;
    defaultModel?: string;
    models?: Array<string | { id?: string }>;
  }>;
};
const configuredConnection = config.llmConnections?.find(item => item.slug === connection);
const configuredModels = (configuredConnection?.models ?? []).map(item => typeof item === 'string' ? item : item.id);
if (
  !configuredConnection || configuredConnection.providerType !== 'pi' ||
  configuredConnection.defaultModel !== model || !configuredModels.includes(model)
) {
  throw new Error('Configured Hana E2E connection does not resolve exactly to the canonical Pi model.');
}

const workspace = process.env.OFFICECLI_HANA_WORKSPACE
  ? resolve(process.env.OFFICECLI_HANA_WORKSPACE)
  : mkdtempSync(join(tmpdir(), 'selection-hana-officecli-e2e-'));
mkdirSync(workspace, { recursive: true });
const attachmentDir = join(workspace, 'input');
mkdirSync(attachmentDir, { recursive: true });
const attachmentPath = join(attachmentDir, 'pasted-text-1.txt');
copyFileSync(sourcePath, attachmentPath);
const source = readFileSync(attachmentPath, 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');
if (sourceHash !== CANONICAL_HANA_SOURCE_SHA256) {
  throw new Error('OFFICECLI_HANA_SOURCE does not match the canonical HanaAgent fixture hash.');
}
const expectedDocument = join(workspace, 'HanaAgent-介绍.docx');
rmSync(expectedDocument, { force: true });

// Source and packaged-layout wrappers resolve Bun relative to their own
// resources directory. Stage both layouts so the E2E cannot silently depend
// on whichever asset tree happened to be built most recently.
const trustedBunPaths = [
  join(repoRoot, 'apps/electron/vendor/bun', process.platform === 'win32' ? 'bun.exe' : 'bun'),
  join(repoRoot, 'apps/electron/dist/vendor/bun', process.platform === 'win32' ? 'bun.exe' : 'bun'),
];
const stagedTrustedBunPaths: string[] = [];
for (const trustedBunPath of trustedBunPaths) {
  if (existsSync(trustedBunPath)) continue;
  mkdirSync(resolve(trustedBunPath, '..'), { recursive: true });
  linkSync(process.execPath, trustedBunPath);
  stagedTrustedBunPaths.push(trustedBunPath);
}

const token = `${randomUUID()}${randomUUID()}`;
const serverEntry = join(repoRoot, 'packages/server/src/index.ts');
const { CLAUDECODE: _claudeCode, ...parentEnv } = process.env;
const server = Bun.spawn([process.execPath, 'run', serverEntry], {
  cwd: repoRoot,
  env: {
    ...parentEnv,
    CRAFT_SERVER_TOKEN: token,
    CRAFT_RPC_HOST: '127.0.0.1',
    CRAFT_RPC_PORT: '0',
    CRAFT_HEALTH_PORT: '0',
    CRAFT_APP_ROOT: repoRoot,
    CRAFT_RESOURCES_PATH: join(repoRoot, 'apps/electron'),
    CRAFT_BUNDLED_ASSETS_ROOT: repoRoot,
    CRAFT_CONFIG_DIR: configDir,
    CRAFT_FEATURE_OFFICECLI_TYPED_TOOLS: '1',
    CRAFT_IS_PACKAGED: 'false',
  },
  stdout: 'pipe',
  stderr: 'pipe',
});

async function stopServer(): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      server.exited,
      new Promise<void>(resolve => {
        forceKillTimer = setTimeout(() => resolve(), 5_000);
      }),
    ]);
    if (server.exitCode === null) {
      server.kill('SIGKILL');
      await server.exited.catch(() => undefined);
    }
  } finally {
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }
}

let serverStderr = '';
void (async () => {
  const reader = server.stderr.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    serverStderr = `${serverStderr}${decoder.decode(value, { stream: true })}`.slice(-32_768);
  }
})();

async function waitForServerUrl(): Promise<string> {
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const next = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Selection server startup timed out.')), remaining)),
    ]);
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    for (const line of buffer.split('\n')) {
      if (line.startsWith('CRAFT_SERVER_URL=')) return line.slice('CRAFT_SERVER_URL='.length).trim();
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
  }
  throw new Error(`Selection server exited before startup (${serverStderr.slice(-500)}).`);
}

function findOfficeFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.selection' || entry.name === 'input') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (['.docx', '.docm'].includes(extname(entry.name).toLowerCase())) files.push(path);
    }
  };
  visit(root);
  return files;
}

let client: WsRpcClient | null = null;
let firstClient: WsRpcClient | null = null;
let sessionId = '';
let completed = false;
let timedOut = false;
const toolStarts: string[] = [];
const toolTimeline: Array<{ name: string; shellVerb?: string }> = [];
const officecliShellVerbs: string[] = [];
let toolResultCount = 0;
const toolErrorNames: string[] = [];
let textCompleteCount = 0;
let noVisionDisclosurePresent = false;
let permissionRequestCount = 0;
let taskErrorCount = 0;
let missingBashCommandError = false;
let richToolMetadataLeaked = false;
let latestUsage: OfficecliTaskUsage | undefined;
const qaStructuralStatuses: Array<'passed' | 'failed'> = [];

try {
  const url = await waitForServerUrl();
  firstClient = new WsRpcClient(url, { token, autoReconnect: false, requestTimeout: 120_000 });
  const createdWorkspace = await firstClient.invoke(
    RPC_CHANNELS.workspaces.CREATE,
    workspace,
    `OfficeCLI Hana E2E ${Date.now()}`,
  ) as { id: string };
  firstClient.destroy();
  firstClient = null;

  client = new WsRpcClient(url, {
    token,
    workspaceId: createdWorkspace.id,
    autoReconnect: false,
    requestTimeout: 120_000,
  });

  let resolveComplete!: () => void;
  const completion = new Promise<void>(resolve => { resolveComplete = resolve; });
  client.on(RPC_CHANNELS.sessions.EVENT, (event: SessionEvent) => {
    if (!sessionId || event.sessionId !== sessionId) return;
    if (event.type === 'tool_start') {
      toolStarts.push(event.toolName);
      const timelineEntry: { name: string; shellVerb?: string } = { name: event.toolName };
      const toolInput = ((event as unknown as {
        input?: Record<string, unknown>;
        toolInput?: Record<string, unknown>;
      }).input ?? (event as unknown as { toolInput?: Record<string, unknown> }).toolInput) ?? {};
      richToolMetadataLeaked ||= '_intent' in toolInput || '_displayName' in toolInput;
      if (event.toolName === 'Bash' && typeof toolInput.command === 'string') {
        const command = toolInput.command;
        for (const match of command.matchAll(/(?:^|[\s"'\/])officecli(?:-[\w-]+)?\s+(create|open|save|close|add|set|remove|move|swap|batch|validate|get|query|view)\b/gi)) {
          officecliShellVerbs.push(match[1]!.toLowerCase());
          timelineEntry.shellVerb = match[1]!.toLowerCase();
        }
      }
      toolTimeline.push(timelineEntry);
    }
    if (event.type === 'tool_result') {
      toolResultCount += 1;
      if (event.isError) toolErrorNames.push(event.toolName);
      if (/officecli_qa$/i.test(event.toolName)) {
        try {
          const parsed = JSON.parse(event.result.replace(/^\s*\[ERROR\]\s*/u, '')) as {
            structuralStatus?: unknown;
          };
          if (parsed.structuralStatus === 'passed' || parsed.structuralStatus === 'failed') {
            qaStructuralStatuses.push(parsed.structuralStatus);
          }
        } catch {
          // Missing or malformed structured QA output must fail the gate below.
        }
      }
      if (event.isError && event.toolName === 'Bash') {
        missingBashCommandError ||= /(?:missing|required)[^\n]{0,40}\bcommand\b|\bcommand\b[^\n]{0,40}(?:missing|required)/i.test(event.result);
      }
    }
    if (event.type === 'text_complete') {
      textCompleteCount += 1;
      if (!event.isIntermediate) {
        noVisionDisclosurePresent = /结构(?:化)?验证[^。！？\n]{0,20}(?:通过|完成)/u.test(event.text) &&
          /(?:未|没有|无法)[^。！？\n]{0,20}(?:像素级|视觉)[^。！？\n]{0,20}(?:确认|检查|验证)/u.test(event.text);
      }
    }
    if (event.type === 'error' || event.type === 'typed_error') taskErrorCount += 1;
    if (event.type === 'usage_update' && event.tokenUsage.lastOfficecliTask) {
      latestUsage = event.tokenUsage.lastOfficecliTask;
    }
    if (event.type === 'permission_request') {
      permissionRequestCount += 1;
      void client?.invoke(
        RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
        sessionId,
        event.request.requestId,
        true,
        false,
      );
    }
    if (event.type === 'complete') {
      completed = true;
      latestUsage = event.tokenUsage?.lastOfficecliTask ?? latestUsage;
      resolveComplete();
    }
  });

  const session = await client.invoke(RPC_CHANNELS.sessions.CREATE, createdWorkspace.id, {
    name: 'HanaAgent OfficeCLI E2E',
    permissionMode: 'allow-all',
    workingDirectory: workspace,
    model,
    llmConnection: connection,
    thinkingLevel: 'low',
  }) as { id: string };
  sessionId = session.id;

  const size = statSync(attachmentPath).size;
  const attachment = {
    type: 'text' as const,
    path: attachmentPath,
    storedPath: attachmentPath,
    name: basename(attachmentPath),
    mimeType: 'text/plain',
    text: source,
    size,
  };
  const storedAttachment = {
    id: randomUUID(),
    type: 'text' as const,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size,
    storedPath: attachmentPath,
  };

  const startedAt = Date.now();
  await client.invoke(
    RPC_CHANNELS.sessions.SEND_MESSAGE,
    sessionId,
    '能将这个写成 Word 吗？还要有目录结构。请在工作目录实际生成并交付 HanaAgent-介绍.docx，不要只给操作说明。',
    [attachment],
    [storedAttachment],
    {},
  );
  let completionTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      completion,
      new Promise<void>(resolve => {
        completionTimer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
      }),
    ]);
  } finally {
    if (completionTimer) clearTimeout(completionTimer);
  }
  const wallClockMs = Date.now() - startedAt;
  if (timedOut) {
    await client.invoke(RPC_CHANNELS.sessions.CANCEL, sessionId).catch(() => undefined);
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  const finalSession = await client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, sessionId) as {
    model?: string;
    llmConnection?: string;
    messages?: Array<{ type?: string; content?: string; isIntermediate?: boolean }>;
    tokenUsage?: { lastOfficecliTask?: OfficecliTaskUsage };
  };
  latestUsage = finalSession.tokenUsage?.lastOfficecliTask ?? latestUsage;

  const documents = findOfficeFiles(workspace);
  const document = existsSync(expectedDocument) ? expectedDocument : undefined;
  const outputOwnedByRun = Boolean(document && statSync(document).mtimeMs >= startedAt - 1_000);
  const extraDocumentCount = documents.filter(path => resolve(path) !== resolve(expectedDocument)).length;
  const resolvedModel = finalSession.model;
  const resolvedConnection = finalSession.llmConnection;
  const binary = resolveOfficecliBinary({
    cwd: repoRoot,
    appRootPath: repoRoot,
    resourcesPath: join(repoRoot, 'apps/electron'),
    trustEnvironment: false,
  });
  let openxmlValidated = false;
  let headingOutlinePassed = false;
  let headingCount = 0;
  let headingLevelsPassed = false;
  let criticalSectionsPassed = false;
  let tableCount = 0;
  let issuesPassed = false;
  let htmlStructurePassed = false;
  let placeholderScanPassed = false;
  let tocPassed = false;
  let pageFieldPassed = false;
  let attributionClean = false;
  if (document && binary) {
    const executeJson = async (args: string[]) => {
      const result = await runOfficecli(binary, [...args, '--json'], { cwd: workspace, timeoutMs: 30_000 });
      return { result, json: parseOfficecliJson(result.stdout) };
    };
    const validation = await executeJson(['validate', document]);
    openxmlValidated = validation.result.exitCode === 0 && validation.json?.success === true;
    const outline = await executeJson(['view', document, 'outline']);
    const outlineData = outline.json?.data as { headings?: Array<Record<string, unknown>> } | undefined;
    const headings = Array.isArray(outlineData?.headings) ? outlineData.headings : [];
    headingCount = headings.length;
    headingOutlinePassed = outline.result.exitCode === 0 && headingCount > 0;
    const headingLevels = headings.map(heading => {
      const direct = heading.level ?? heading.outlineLevel;
      if (typeof direct === 'number') return direct;
      if (typeof direct === 'string' && /^\d+$/u.test(direct)) return Number(direct);
      const style = String(heading.styleId ?? heading.style ?? '');
      return Number(style.match(/Heading\s*([1-9])/iu)?.[1] ?? 0);
    }).filter(level => level >= 1 && level <= 9);
    const levelSet = new Set(headingLevels);
    headingLevelsPassed = levelSet.has(1) && levelSet.has(2) && levelSet.has(3);
    const headingText = headings
      .map(heading => String(heading.text ?? heading.title ?? heading.name ?? '').replace(/\s+/gu, ''));
    const criticalSections = ['HanaAgent是什么', '功能特性', '快速开始', '架构', '技术栈', '平台支持', '开发'];
    criticalSectionsPassed = criticalSections.every(expected =>
      headingText.some(actual => actual.includes(expected))
    );
    const tables = await executeJson(['query', document, 'table']);
    tableCount = tables.result.exitCode === 0
      ? Number((tables.json?.data as { matches?: number } | undefined)?.matches ?? 0)
      : 0;
    const toc = await executeJson(['query', document, 'toc']);
    tocPassed = toc.result.exitCode === 0 && Number((toc.json?.data as { matches?: number } | undefined)?.matches ?? 0) > 0;
    const page = await executeJson(['query', document, 'field[fieldType=page]']);
    pageFieldPassed = page.result.exitCode === 0 && Number((page.json?.data as { matches?: number } | undefined)?.matches ?? 0) > 0;
    const issues = await executeJson(['view', document, 'issues']);
    const issueItems = (issues.json?.data as { issues?: Array<{ severity?: number }> } | undefined)?.issues ?? [];
    issuesPassed = issues.result.exitCode === 0 && issues.json?.success === true &&
      issueItems.every(issue => Number(issue.severity ?? 0) < 3);
    const html = await executeJson(['view', document, 'html']);
    const htmlData = html.json?.data;
    htmlStructurePassed = html.result.exitCode === 0 && html.json?.success === true &&
      typeof htmlData === 'string' && /<!doctype html/i.test(htmlData) && /class=["']page/i.test(htmlData);
    const textView = await runOfficecli(binary, ['view', document, 'text'], { cwd: workspace, timeoutMs: 30_000 });
    placeholderScanPassed = textView.exitCode === 0 && !textView.timedOut && !textView.outputTruncated &&
      !/\{\{[^{}\r\n]+\}\}|\[(?:TODO|TBD|PLACEHOLDER)\]|<<(?:TODO|TBD|[^<>\r\n]{1,80})>>|\b(?:TODO|TBD|Lorem ipsum)\b|\\[nrtvabf]/iu.test(textView.stdout);
    attributionClean = inspectOfficecliAttribution(document).clean;
  }

  const usage = latestUsage;
  const qaToolErrored = toolErrorNames.some(name => /officecli_qa$/i.test(name));
  const finalizeToolErrored = toolErrorNames.some(name => /officecli_finalize$/i.test(name));
  // The resident is intentionally closed by finalize, so post-delivery
  // preview commands may be unavailable. Only an explicitly parsed, passing
  // typed QA result can substitute for those post-close preview checks.
  const qaStructurallyPassed = Boolean(
    usage && usage.qaCalls >= 1 &&
    qaStructuralStatuses.length === usage.qaCalls &&
    qaStructuralStatuses.at(-1) === 'passed' &&
    !qaToolErrored
  );
  issuesPassed ||= qaStructurallyPassed;
  htmlStructurePassed ||= qaStructurallyPassed;
  if (!noVisionDisclosurePresent) {
    const finalAssistant = [...(finalSession.messages ?? [])].reverse()
      .find(message => message.type === 'assistant' && !message.isIntermediate);
    if (typeof finalAssistant?.content === 'string') {
      noVisionDisclosurePresent = /结构(?:化)?验证[^。！？\n]{0,20}(?:通过|完成)/u.test(finalAssistant.content) &&
        /(?:未|没有|无法)[^。！？\n]{0,20}(?:像素级|视觉)[^。！？\n]{0,20}(?:确认|检查|验证)/u.test(finalAssistant.content);
    }
  }
  const qaIndexes = toolTimeline.flatMap((entry, index) => /officecli_qa$/i.test(entry.name) ? [index] : []);
  const batchIndexes = toolTimeline.flatMap((entry, index) => /officecli_batch$/i.test(entry.name) ? [index] : []);
  const finalizeIndexes = toolTimeline.flatMap((entry, index) => /officecli_finalize$/i.test(entry.name) ? [index] : []);
  const lastQaIndex = qaIndexes.at(-1) ?? -1;
  const finalizeIndex = finalizeIndexes[0] ?? -1;
  const mutationAfterFinalize = toolTimeline.slice(finalizeIndex + 1).some(entry =>
    /officecli_batch$/i.test(entry.name) ||
    (entry.name === 'Bash' && ['add', 'set', 'remove', 'move', 'swap', 'batch', 'save', 'close'].includes(entry.shellVerb ?? ''))
  );
  const repairSequencePassed = qaIndexes.length === 1
    ? batchIndexes.every(index => index < qaIndexes[0]!)
    : qaIndexes.length === 2 &&
      batchIndexes.filter(index => index > qaIndexes[0]! && index < qaIndexes[1]!).length === 1 &&
      batchIndexes.every(index => index < qaIndexes[0]! || (index > qaIndexes[0]! && index < qaIndexes[1]!));
  const rawResultRelativePath = relative(repoRoot, resultPath);
  const resultIsInRepo = rawResultRelativePath !== '' && !isAbsolute(rawResultRelativePath) &&
    rawResultRelativePath !== '..' &&
    !rawResultRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
  const resultRelativePath = rawResultRelativePath.replaceAll('\\', '/');
  const gitDiff = Bun.spawnSync(
    resultIsInRepo
      ? ['git', 'diff', '--binary', 'HEAD', '--', '.', `:(exclude)${resultRelativePath}`]
      : ['git', 'diff', '--binary', 'HEAD'],
    { cwd: repoRoot },
  ).stdout;
  const untrackedOutput = Bun.spawnSync(
    ['git', 'ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: repoRoot },
  ).stdout.toString();
  const untrackedFiles = untrackedOutput.split('\0')
    .filter(path => Boolean(path) && (!resultIsInRepo || path !== resultRelativePath))
    .sort();
  const candidateHasher = createHash('sha256').update(gitDiff);
  for (const relativePath of untrackedFiles) {
    candidateHasher.update('\0untracked\0').update(relativePath).update('\0');
    candidateHasher.update(readFileSync(join(repoRoot, relativePath)));
  }
  const candidateDirty = gitDiff.length > 0 || untrackedFiles.length > 0;
  const candidateDiffHash = candidateDirty ? candidateHasher.digest('hex') : null;
  const versionResult = binary
    ? await runOfficecli(binary, ['--version'], { cwd: workspace, timeoutMs: 10_000 })
    : undefined;
  const officecliVersion = versionResult?.exitCode === 0 ? versionResult.stdout.trim() : null;
  const result = {
    schemaVersion: 2,
    fixtureId: 'hanaagent-original-pasted-text-v1',
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    commit: Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.toString().trim(),
    workingTreeClean: !candidateDirty,
    candidateDiffHash,
    sourceHash,
    requestedModel: model,
    resolvedModel,
    requestedConnection: connection,
    resolvedConnection,
    resolvedProvider: configuredConnection.piAuthProvider ?? null,
    officecliVersion,
    completed,
    timedOut,
    wallClockMs,
    toolStartEvents: toolStarts.length,
    toolResultEvents: toolResultCount,
    textCompleteEvents: textCompleteCount,
    permissionRequestCount,
      taskErrorCount,
      toolErrorNames,
      missingBashCommandError,
      richToolMetadataLeaked,
    officecliShellVerbCounts: Object.fromEntries(
      [...new Set(officecliShellVerbs)].sort().map(verb => [verb, officecliShellVerbs.filter(item => item === verb).length]),
    ),
    toolNames: Object.fromEntries([...new Set(toolStarts)].sort().map(name => [name, toolStarts.filter(item => item === name).length])),
    officecli: usage ?? null,
    output: {
      documentCount: documents.length,
      expectedDocumentPresent: Boolean(document),
      outputOwnedByRun,
      extraDocumentCount,
      openxmlValidated,
      headingOutlinePassed,
      headingCount,
      headingLevelsPassed,
      criticalSectionsPassed,
      tableCount,
      issuesPassed,
      htmlStructurePassed,
      placeholderScanPassed,
      tocPassed,
      pageFieldPassed,
      attributionClean,
      noVisionDisclosurePresent,
    },
    gates: {
      canonicalFixture: sourceHash === CANONICAL_HANA_SOURCE_SHA256,
      canonicalModelResolved: resolvedModel === CANONICAL_HANA_MODEL && resolvedConnection === CANONICAL_HANA_CONNECTION,
      under35ToolEvents: toolStarts.length <= 35,
      under25ModelCalls: Boolean(usage && usage.measuredModelCalls <= 25),
      underFiveMinutes: wallClockMs <= 300_000,
      usedBatch: Boolean(usage && usage.batchCalls >= 1),
      noDirectMutationLoop: Boolean(usage && usage.directMutations <= 8),
      balancedQaOneOrTwo: Boolean(
        usage && usage.qaCalls >= 1 && usage.qaCalls <= 2 &&
        usage.qaModes.balanced === usage.qaCalls &&
        qaStructuralStatuses.length === usage.qaCalls &&
        qaStructuralStatuses.at(-1) === 'passed'
      ),
      textModelQaSkippedVision: Boolean(
        usage && usage.visualStatuses.skipped_no_vision === usage.qaCalls &&
        (usage.visualStatuses.checked ?? 0) === 0
      ),
      noVisionDisclosurePresent,
      noTaskErrors: taskErrorCount === 0,
      noCriticalToolErrors: !missingBashCommandError && !qaToolErrored && !finalizeToolErrored,
      minimaxToolMetadataCompatible: !richToolMetadataLeaked,
      contentBatchDiscipline: Boolean(
        usage && usage.batchCalls >= 2 && usage.batchCalls <= 6 &&
        usage.batchSizes.some(size => size >= 20 && size <= 50) &&
        usage.batchSizes.filter(size => size < 20).length <= 2 &&
        usage.batchSizes.every(size => size >= 1 && size <= 50)
      ),
      noCreateThenOpen: officecliShellVerbs.filter(verb => verb === 'create').length === 1 &&
        !officecliShellVerbs.includes('open'),
      repairSequencePassed,
      finalizedOnceAfterQa: finalizeIndexes.length === 1 && finalizeIndex > lastQaIndex && !mutationAfterFinalize,
      exactFreshOutputOnly: Boolean(document) && outputOwnedByRun && extraDocumentCount === 0,
      structuralQuality: headingCount >= 8 && headingLevelsPassed && criticalSectionsPassed && tableCount >= 2 &&
        issuesPassed && htmlStructurePassed && placeholderScanPassed,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  mkdirSync(dirname(resultPath), { recursive: true });
  const temporaryResult = `${resultPath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryResult, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(temporaryResult, resultPath);
  if (
    !completed || timedOut || !document || !openxmlValidated || !headingOutlinePassed ||
    !tocPassed || !pageFieldPassed || !attributionClean || Object.values(result.gates).some(value => !value)
  ) process.exitCode = 1;
} finally {
  client?.destroy();
  firstClient?.destroy();
  await stopServer();
  if (!keepWorkspace) rmSync(workspace, { recursive: true, force: true });
  for (const trustedBunPath of stagedTrustedBunPaths) {
    const trustedBunDir = resolve(trustedBunPath, '..');
    rmSync(trustedBunPath, { force: true });
    try { rmSync(trustedBunDir); } catch {}
    try { rmSync(join(trustedBunDir, '..')); } catch {}
  }
}
