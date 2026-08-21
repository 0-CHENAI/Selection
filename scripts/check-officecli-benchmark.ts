#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Format = 'docx' | 'xlsx' | 'pptx';

export interface BenchmarkTask {
  id: string;
  format: Format;
  guide: string;
  tags: string[];
  fixture?: string;
  fixtureSha256?: string;
  requiresInteractivePreview: boolean;
  prompt: string;
  requiredCapabilities: string[];
}

export interface BenchmarkCatalog {
  version: number;
  officecliVersion: string;
  repetitions: number;
  tasks: BenchmarkTask[];
}

export interface Observation {
  taskId: string;
  iteration: number;
  model: string;
  promptHash: string;
  inputHash: string;
  ok: boolean;
  officeToolCalls: number;
  duplicateStatusHelpCalls: number;
  nativeCommands: Array<{ command: string[]; durationMs: number }>;
  modelTotalDurationMs: number;
  output: {
    exists: boolean;
    openable: boolean;
    validated: boolean;
    rendered: boolean;
    currentRevisionEvidence: boolean;
    deliveryReady: boolean;
  };
  internalGuideSkillEntries: number;
  managementNetworkRequests: number;
  manualMicrosoftOfficeGolden?: 'pass' | 'fail' | 'not-run';
}

export interface ObservationFile {
  catalogHash: string;
  observations: Observation[];
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..');
const catalogPath = join(repoRoot, 'benchmarks/officecli/tasks.json');
const manifestPath = join(repoRoot, 'apps/electron/resources/officecli/officecli-manifest.json');

function fail(message: string): never {
  throw new Error(message);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function quantile(values: number[], percentile: number): number {
  if (values.length === 0) fail('Cannot compute a percentile from an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]!;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) fail('Cannot compute a median from an empty sample');
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function validateCatalog(catalog: BenchmarkCatalog, reviewedOfficecliVersion: string): void {
  if (catalog.version !== 1 || !/^\d+\.\d+\.\d+$/.test(catalog.officecliVersion)) fail('Invalid benchmark catalog metadata');
  if (catalog.officecliVersion !== reviewedOfficecliVersion) {
    fail(`Benchmark catalog OfficeCLI version ${catalog.officecliVersion} does not match manifest ${reviewedOfficecliVersion}`);
  }
  if (!Number.isInteger(catalog.repetitions) || catalog.repetitions < 1) fail('Benchmark repetitions must be a positive integer');
  if (!Array.isArray(catalog.tasks)) fail('Benchmark tasks must be an array');
  if (catalog.tasks.length !== 12) fail(`Expected exactly 12 fixed Office tasks, found ${catalog.tasks.length}`);
  const ids = new Set<string>();
  for (const task of catalog.tasks) {
    if (ids.has(task.id)) fail(`Duplicate benchmark task id: ${task.id}`);
    ids.add(task.id);
    if (!['docx', 'xlsx', 'pptx'].includes(task.format)) fail(`Invalid format for ${task.id}`);
    if (
      typeof task.id !== 'string'
      || typeof task.guide !== 'string'
      || typeof task.prompt !== 'string'
      || task.prompt.length < 30
      || !Array.isArray(task.tags)
      || task.tags.some(tag => typeof tag !== 'string')
      || !Array.isArray(task.requiredCapabilities)
      || task.requiredCapabilities.length < 3
      || task.requiredCapabilities.some(capability => typeof capability !== 'string')
      || typeof task.requiresInteractivePreview !== 'boolean'
    ) fail(`Incomplete benchmark task: ${task.id}`);
    if (task.fixture) {
      const fixturePath = join(dirname(catalogPath), task.fixture);
      if (!existsSync(fixturePath)) fail(`Missing benchmark fixture for ${task.id}: ${task.fixture}`);
      if (!task.fixtureSha256 || sha256(readFileSync(fixturePath)) !== task.fixtureSha256) {
        fail(`Benchmark fixture hash mismatch for ${task.id}: ${task.fixture}`);
      }
    }
  }
  for (const format of ['docx', 'xlsx', 'pptx'] as const) {
    const count = catalog.tasks.filter(task => task.format === format).length;
    if (count !== 4) fail(`Expected four ${format} tasks, found ${count}`);
  }
  if (!catalog.tasks.some(task => task.tags.includes('issue-60'))) fail('Benchmark catalog is missing the issue #60 path task');
  if (!catalog.tasks.some(task => task.guide === 'financial-model' && task.tags.includes('cross-sheet'))) {
    fail('Benchmark catalog is missing the cross-sheet financial model task');
  }
  if (!catalog.tasks.some(task => task.guide === 'morph-ppt') || !catalog.tasks.some(task => task.guide === 'morph-ppt-3d')) {
    fail('Benchmark catalog is missing fixed Morph and Morph 3D tasks');
  }
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function validateObservationFile(
  label: string,
  file: ObservationFile,
  catalog: BenchmarkCatalog,
  catalogHash: string,
): Map<string, Observation> {
  if (file.catalogHash !== catalogHash) fail(`${label} was recorded against a different benchmark catalog`);
  if (!Array.isArray(file.observations)) fail(`${label} observations must be an array`);
  const expectedCount = catalog.tasks.length * catalog.repetitions;
  if (file.observations.length !== expectedCount) {
    fail(`${label} must contain exactly ${expectedCount} observations, found ${file.observations.length}`);
  }
  const known = new Set(catalog.tasks.map(task => task.id));
  const keyed = new Map<string, Observation>();
  for (const observation of file.observations) {
    if (!known.has(observation.taskId)) fail(`${label} contains unknown task ${observation.taskId}`);
    if (!Number.isInteger(observation.iteration) || observation.iteration < 1 || observation.iteration > catalog.repetitions) {
      fail(`${label} has invalid iteration for ${observation.taskId}`);
    }
    const key = `${observation.taskId}:${observation.iteration}`;
    if (keyed.has(key)) fail(`${label} contains duplicate observation ${key}`);
    if (typeof observation.model !== 'string' || !observation.model || !/^[0-9a-f]{64}$/.test(observation.promptHash) || !/^[0-9a-f]{64}$/.test(observation.inputHash)) {
      fail(`${label} has incomplete reproducibility metadata for ${key}`);
    }
    if (
      typeof observation.ok !== 'boolean'
      || !nonNegativeInteger(observation.officeToolCalls)
      || !nonNegativeInteger(observation.duplicateStatusHelpCalls)
      || observation.duplicateStatusHelpCalls > observation.officeToolCalls
      || !nonNegativeFinite(observation.modelTotalDurationMs)
      || !nonNegativeInteger(observation.internalGuideSkillEntries)
      || !nonNegativeInteger(observation.managementNetworkRequests)
    ) {
      fail(`${label} has invalid metrics for ${key}`);
    }
    if (
      !Array.isArray(observation.nativeCommands)
      || observation.nativeCommands.length === 0
      || observation.nativeCommands.some(item => (
        !item
        || !Array.isArray(item.command)
        || item.command.length === 0
        || item.command.some(token => typeof token !== 'string' || token.includes('\0'))
        || !nonNegativeFinite(item.durationMs)
      ))
    ) {
      fail(`${label} has invalid native command timings for ${key}`);
    }
    const outputKeys = ['exists', 'openable', 'validated', 'rendered', 'currentRevisionEvidence', 'deliveryReady'] as const;
    if (
      !observation.output
      || typeof observation.output !== 'object'
      || outputKeys.some(field => typeof observation.output[field] !== 'boolean')
      || Object.keys(observation.output).some(field => !outputKeys.includes(field as typeof outputKeys[number]))
    ) fail(`${label} has invalid output evidence for ${key}`);
    if (
      observation.manualMicrosoftOfficeGolden !== undefined
      && !['pass', 'fail', 'not-run'].includes(observation.manualMicrosoftOfficeGolden)
    ) fail(`${label} has invalid manual golden status for ${key}`);
    keyed.set(key, observation);
  }
  for (const task of catalog.tasks) {
    for (let iteration = 1; iteration <= catalog.repetitions; iteration += 1) {
      if (!keyed.has(`${task.id}:${iteration}`)) fail(`${label} is missing ${task.id}:${iteration}`);
    }
  }
  return keyed;
}

function assertAfterQuality(after: Map<string, Observation>, catalog: BenchmarkCatalog, releaseGate: boolean): void {
  for (const [key, observation] of after) {
    const task = catalog.tasks.find(candidate => candidate.id === observation.taskId)!;
    if (!observation.ok) fail(`After-run failed: ${key}`);
    if (observation.duplicateStatusHelpCalls !== 0) fail(`Repeated status/help calls must be zero: ${key}`);
    if (observation.internalGuideSkillEntries !== 0) fail(`Internal Office guides leaked into Skill RPC/UI: ${key}`);
    if (observation.managementNetworkRequests !== 0) fail(`Core Office work made install/update/management network requests: ${key}`);
    if (Object.values(observation.output).some(value => value !== true)) fail(`Current-revision output gates failed: ${key}`);
    if (task.tags.includes('issue-60') && !observation.output.deliveryReady) fail(`Issue #60 path task did not deliver: ${key}`);
    if (releaseGate && observation.manualMicrosoftOfficeGolden !== 'pass') {
      fail(`Microsoft Office golden review is not recorded as pass: ${key}`);
    }
  }
}

export function compare(beforePath: string, afterPath: string, releaseGate: boolean): void {
  const catalogContents = readFileSync(catalogPath);
  const catalogHash = sha256(catalogContents);
  const catalog = JSON.parse(catalogContents.toString('utf8')) as BenchmarkCatalog;
  const manifest = readJson<{ version: string }>(manifestPath);
  validateCatalog(catalog, manifest.version);
  const before = validateObservationFile('before', readJson<ObservationFile>(resolve(beforePath)), catalog, catalogHash);
  const after = validateObservationFile('after', readJson<ObservationFile>(resolve(afterPath)), catalog, catalogHash);
  for (const [key, observation] of before) {
    const candidate = after.get(key)!;
    if (observation.model !== candidate.model || observation.promptHash !== candidate.promptHash || observation.inputHash !== candidate.inputHash) {
      fail(`Model, prompt, or input changed between before/after for ${key}`);
    }
  }
  assertAfterQuality(after, catalog, releaseGate);
  const beforeRuns = [...before.values()];
  const afterRuns = [...after.values()];
  const beforeCalls = beforeRuns.map(run => run.officeToolCalls);
  const afterCalls = afterRuns.map(run => run.officeToolCalls);
  const beforeNative = beforeRuns.flatMap(run => run.nativeCommands.map(command => command.durationMs));
  const afterNative = afterRuns.flatMap(run => run.nativeCommands.map(command => command.durationMs));
  const metrics = {
    officeToolCalls: {
      beforeMedian: median(beforeCalls),
      afterMedian: median(afterCalls),
      allowedMedian: median(beforeCalls) * 0.6,
      beforeP95: quantile(beforeCalls, 0.95),
      afterP95: quantile(afterCalls, 0.95),
    },
    nativeCommandDurationMs: {
      beforeMedian: median(beforeNative),
      afterMedian: median(afterNative),
      allowedMedian: median(beforeNative) * 0.7,
    },
    modelTotalDurationMs: {
      beforeMedian: median(beforeRuns.map(run => run.modelTotalDurationMs)),
      afterMedian: median(afterRuns.map(run => run.modelTotalDurationMs)),
      gateApplied: false,
    },
  };
  if (metrics.officeToolCalls.afterMedian > metrics.officeToolCalls.allowedMedian) fail(`Office tool-call median gate failed: ${JSON.stringify(metrics.officeToolCalls)}`);
  if (metrics.officeToolCalls.afterP95 > metrics.officeToolCalls.beforeP95) fail(`Office tool-call P95 gate failed: ${JSON.stringify(metrics.officeToolCalls)}`);
  if (metrics.nativeCommandDurationMs.afterMedian > metrics.nativeCommandDurationMs.allowedMedian) fail(`Native command duration median gate failed: ${JSON.stringify(metrics.nativeCommandDurationMs)}`);
  console.log(JSON.stringify({ ok: true, catalogHash, releaseGate, metrics }, null, 2));
}

if (import.meta.main) {
  const catalogContents = readFileSync(catalogPath);
  const catalog = JSON.parse(catalogContents.toString('utf8')) as BenchmarkCatalog;
  const manifest = readJson<{ version: string }>(manifestPath);
  validateCatalog(catalog, manifest.version);
  const args = process.argv.slice(2);
  const compareIndex = args.indexOf('--compare');
  if (compareIndex >= 0) {
    const before = args[compareIndex + 1];
    const after = args[compareIndex + 2];
    if (!before || !after) fail('Usage: --compare <before.json> <after.json> [--release-gate]');
    compare(before, after, args.includes('--release-gate'));
  } else {
    console.log(JSON.stringify({
      ok: true,
      catalogHash: sha256(catalogContents),
      officecliVersion: catalog.officecliVersion,
      taskCount: catalog.tasks.length,
      counts: Object.fromEntries(['docx', 'xlsx', 'pptx'].map(format => [format, catalog.tasks.filter(task => task.format === format).length])),
      repetitions: catalog.repetitions,
    }, null, 2));
  }
}
