#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

type GuideName =
  | 'word' | 'excel' | 'pptx' | 'academic-paper' | 'financial-model'
  | 'data-dashboard' | 'pitch-deck' | 'word-form' | 'morph-ppt' | 'morph-ppt-3d';

interface ManifestGuide {
  directory: string;
  entry: string;
  contentHash: string;
  resourceHash: string;
  inherits: GuideName[];
}

export interface OfficecliManifest {
  manifestVersion: number;
  version: string;
  tag: string;
  tagCommit: string;
  schemaCrc: string;
  sourceRepository: string;
  license: {
    spdx: string;
    licenseFile: string;
    licenseSha256: string;
    noticeFile: string;
    noticeSha256: string;
  };
  assets: Record<string, { name: string; url: string; sha256: string }>;
  commandPolicy: Record<'read' | 'edit' | 'preview' | 'lifecycle' | 'admin', string[]>;
  compatibilityRecipes?: {
    importViaAtomicBatch?: { enabled: boolean; maxSourceBytes: number; reason: string };
  };
  commandSchema?: { file: string; sha256: string; unclassifiedCommands: string[]; staleClassifications: string[] };
  guideIndex?: { file: string; sha256: string };
  externalDependencies: Array<{
    id: string;
    version: string;
    license: string;
    networkRequiredFor: string[];
    fallback: string;
    hosts: string[];
  }>;
  guides: Record<GuideName, ManifestGuide>;
}

export interface CommandSnapshot {
  version: string;
  schemaCrc: string;
  generatedFrom: 'reviewed-release-binary';
  rootHelpSha256: string;
  helpAllSha256: string;
  helpAllEntries: number;
  rootCommands: string[];
  commands: Record<string, { helpSha256: string; flags: string[] }>;
}

interface GuideIndex {
  version: string;
  guides: Record<string, {
    directory: string;
    entry: string;
    headings: Array<{ level: number; title: string }>;
    files: Array<{ path: string; sha256: string; sizeBytes: number }>;
  }>;
}

interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

const repoRoot = resolve(import.meta.dir, '..');
const officeRoot = join(repoRoot, 'apps/electron/resources/officecli');
const manifestPath = join(officeRoot, 'officecli-manifest.json');
const reportPath = join(officeRoot, 'officecli-upgrade-report.md');
const REQUIRED_PLATFORM_ASSETS: Record<string, string> = {
  'darwin-arm64': 'officecli-mac-arm64',
  'darwin-x64': 'officecli-mac-x64',
  'linux-x64': 'officecli-linux-x64',
  'linux-arm64': 'officecli-linux-arm64',
  'win32-x64': 'officecli-win-x64.exe',
  'win32-arm64': 'officecli-win-arm64.exe',
};
const GUIDE_LAYOUT: Record<GuideName, { directory: string; entry: string; inherits: GuideName[] }> = {
  word: { directory: 'officecli-docx', entry: 'SKILL.md', inherits: [] },
  excel: { directory: 'officecli-xlsx', entry: 'SKILL.md', inherits: [] },
  pptx: { directory: 'officecli-pptx', entry: 'SKILL.md', inherits: [] },
  'academic-paper': { directory: 'officecli-academic-paper', entry: 'SKILL.md', inherits: ['word'] },
  'financial-model': { directory: 'officecli-financial-model', entry: 'SKILL.md', inherits: ['excel'] },
  'data-dashboard': { directory: 'officecli-data-dashboard', entry: 'SKILL.md', inherits: ['excel'] },
  'pitch-deck': { directory: 'officecli-pitch-deck', entry: 'SKILL.md', inherits: ['pptx'] },
  'word-form': { directory: 'officecli-word-form', entry: 'SKILL.md', inherits: ['word'] },
  'morph-ppt': { directory: 'morph-ppt', entry: 'SKILL.md', inherits: ['pptx'] },
  'morph-ppt-3d': { directory: 'morph-ppt-3d', entry: 'SKILL.md', inherits: ['morph-ppt', 'pptx'] },
};
const SAFE_GUIDE_EXTENSIONS = new Set(['.md', '.pptx']);
const POLICY_ONLY_COMMANDS = new Set([
  'status', 'update', 'config', 'load_skill',
  'mark', 'unmark', 'get-marks', 'goto', 'selection',
]);
const REQUIRED_ADMIN_COMMANDS = new Set(['install', 'update', 'skills', 'load_skill', 'mcp', 'plugins', 'config']);
const REVIEWED_EXTERNAL_HOSTS = new Set(['d.officecli.ai', 'cdn.jsdelivr.net']);
const REQUIRED_EXTERNAL_DEPENDENCIES = new Set(['katex', 'three', 'mermaid', 'mermaid-layout-elk']);
const REVIEWED_DOWNLOAD_HOSTS = new Set(['github.com', 'codeload.github.com']);

export function validateOfficecliReleaseAssetUrl(tag: string, name: string, rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`OfficeCLI release asset URL is invalid for ${name}: ${rawUrl}`);
  }
  const expectedPath = `/iOfficeAI/OfficeCLI/releases/download/${tag}/${name}`;
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'github.com'
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== expectedPath
  ) {
    throw new Error(`OfficeCLI release asset URL is not the exact reviewed GitHub release path for ${name}: ${rawUrl}`);
  }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileHash(path: string): string {
  return sha256(readFileSync(path));
}

function textFileHash(path: string): string {
  return sha256(readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
}

export function commandSchemaContract(snapshot: CommandSnapshot): {
  version: string;
  schemaCrc: string;
  generatedFrom: CommandSnapshot['generatedFrom'];
  helpAllEntries: number;
  rootCommands: string[];
  flags: Record<string, string[]>;
} {
  return {
    version: snapshot.version,
    schemaCrc: snapshot.schemaCrc,
    generatedFrom: snapshot.generatedFrom,
    helpAllEntries: snapshot.helpAllEntries,
    rootCommands: snapshot.rootCommands,
    flags: Object.fromEntries(
      Object.entries(snapshot.commands).map(([name, command]) => [name, command.flags]),
    ),
  };
}

export function commandSchemaContractsEqual(left: CommandSnapshot, right: CommandSnapshot): boolean {
  return JSON.stringify(commandSchemaContract(left)) === JSON.stringify(commandSchemaContract(right));
}

function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function filesRecursively(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in vendored OfficeCLI resources: ${path}`);
      }
      if (stats.isDirectory()) visit(path);
      else if (stats.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function directoryHash(root: string): string {
  const digest = createHash('sha256');
  for (const path of filesRecursively(root)) {
    digest.update(relative(root, path));
    digest.update('\0');
    digest.update(readFileSync(path));
    digest.update('\0');
  }
  return digest.digest('hex');
}

async function run(binary: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe', env: process.env });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${basename(binary)} ${args.join(' ')} failed (${exitCode}): ${stderr || stdout}`);
  return stdout;
}

function parseRootCommands(help: string): string[] {
  const commandsSection = help.split(/\nCommands:\s*\n/, 2)[1]?.split(/\nSchema Reference/, 1)[0] ?? '';
  return [...new Set(commandsSection.split(/\r?\n/).flatMap(line => {
    const match = /^  ([a-z][a-z0-9-]*)\b/.exec(line);
    return match ? [match[1]!] : [];
  }))].sort();
}

function parseFlags(help: string): string[] {
  return [...new Set(help.match(/--[a-z0-9][a-z0-9-]*/gi) ?? [])].sort();
}

function normalizeCliText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n';
}

async function buildCommandSnapshot(binary: string): Promise<CommandSnapshot> {
  const version = (await run(binary, ['--version'])).trim();
  const schemaCrc = (await run(binary, ['--output-schema-crc'])).trim().toLowerCase();
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{8}$/.test(schemaCrc)) {
    throw new Error(`Invalid OfficeCLI runtime metadata: ${version}/${schemaCrc}`);
  }
  const rootHelp = normalizeCliText(await run(binary, ['--help']));
  const helpAll = normalizeCliText(await run(binary, ['help', 'all', '--json']));
  const helpAllJson = JSON.parse(helpAll) as { success?: boolean; data?: unknown[] };
  if (!helpAllJson.success || !Array.isArray(helpAllJson.data)) throw new Error('help all --json returned an invalid schema envelope');
  const rootCommands = parseRootCommands(rootHelp);
  const commands: CommandSnapshot['commands'] = {};
  for (const command of rootCommands) {
    // `help` is the schema browser itself and treats its first argument as a
    // format, so `help --help` is not a valid command on OfficeCLI 1.0.144.
    const help = normalizeCliText(
      command === 'help' ? await run(binary, ['help']) : await run(binary, [command, '--help']),
    );
    commands[command] = { helpSha256: sha256(help), flags: parseFlags(help) };
  }
  return {
    version,
    schemaCrc,
    generatedFrom: 'reviewed-release-binary',
    rootHelpSha256: sha256(rootHelp),
    helpAllSha256: sha256(helpAll),
    helpAllEntries: helpAllJson.data.length,
    rootCommands,
    commands,
  };
}

function headings(markdown: string): Array<{ level: number; title: string }> {
  return markdown.split(/\r?\n/).flatMap(line => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match ? [{ level: match[1]!.length, title: match[2]! }] : [];
  });
}

function buildGuideIndex(manifest: OfficecliManifest, versionRoot: string): GuideIndex {
  const guides: GuideIndex['guides'] = {};
  for (const [name, definition] of Object.entries(manifest.guides)) {
    const root = join(versionRoot, 'skills', definition.directory);
    const entry = join(root, definition.entry);
    guides[name] = {
      directory: definition.directory,
      entry: definition.entry,
      headings: headings(readFileSync(entry, 'utf8')),
      files: filesRecursively(root).map(path => ({
        path: relative(root, path),
        sha256: fileHash(path),
        sizeBytes: lstatSync(path).size,
      })),
    };
  }
  return { version: manifest.version, guides };
}

function classificationDiff(manifest: OfficecliManifest, snapshot: CommandSnapshot): {
  unclassifiedCommands: string[];
  staleClassifications: string[];
} {
  const classified = new Set(Object.values(manifest.commandPolicy).flat());
  const roots = new Set(snapshot.rootCommands);
  return {
    unclassifiedCommands: snapshot.rootCommands.filter(command => !classified.has(command)),
    staleClassifications: [...classified].filter(command => !roots.has(command) && !POLICY_ONLY_COMMANDS.has(command)).sort(),
  };
}

export function validateManifestFiles(
  manifest: OfficecliManifest,
  options: { allowCommandPolicyDrift?: boolean } = {},
): void {
  if (manifest.manifestVersion !== 1) throw new Error(`Unsupported OfficeCLI manifest version: ${manifest.manifestVersion}`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.tag !== `v${manifest.version}`) {
    throw new Error(`Manifest version/tag mismatch: ${manifest.version}/${manifest.tag}`);
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.tagCommit)) throw new Error(`Invalid tag commit: ${manifest.tagCommit}`);
  if (manifest.sourceRepository !== 'https://github.com/iOfficeAI/OfficeCLI') {
    throw new Error(`Unexpected OfficeCLI source repository: ${manifest.sourceRepository}`);
  }
  const versionRoot = join(officeRoot, manifest.version);
  if (!existsSync(versionRoot)) throw new Error(`Missing vendored OfficeCLI resources: ${versionRoot}`);
  const skillsRoot = join(versionRoot, 'skills');
  const guideNames = Object.keys(manifest.guides).sort();
  const expectedGuideNames = Object.keys(GUIDE_LAYOUT).sort();
  if (JSON.stringify(guideNames) !== JSON.stringify(expectedGuideNames)) {
    throw new Error(`OfficeCLI guide catalog mismatch: ${guideNames.join(', ')}`);
  }
  for (const [name, expected] of Object.entries(GUIDE_LAYOUT)) {
    const actual = manifest.guides[name as GuideName];
    if (
      actual.directory !== expected.directory
      || actual.entry !== expected.entry
      || JSON.stringify(actual.inherits) !== JSON.stringify(expected.inherits)
    ) {
      throw new Error(`OfficeCLI guide layout mismatch for ${name}`);
    }
  }
  const expectedGuideDirectories = new Set(Object.values(manifest.guides).map(guide => guide.directory));
  for (const entry of readdirSync(skillsRoot)) {
    const path = join(skillsRoot, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isDirectory() || !expectedGuideDirectories.has(entry)) {
      throw new Error(`Unexpected vendored OfficeCLI guide resource: ${path}`);
    }
  }
  if (!/^[0-9a-f]{8}$/.test(manifest.schemaCrc)) throw new Error(`Invalid schema CRC: ${manifest.schemaCrc}`);
  for (const key of Object.keys(REQUIRED_PLATFORM_ASSETS)) {
    const asset = manifest.assets[key];
    if (!asset) throw new Error(`Missing platform asset in manifest: ${key}`);
    if (asset.name !== REQUIRED_PLATFORM_ASSETS[key]) throw new Error(`Unexpected asset name for ${key}: ${asset.name}`);
    if (!/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error(`Invalid SHA256 for ${key}`);
    validateOfficecliReleaseAssetUrl(manifest.tag, asset.name, asset.url);
  }
  const unexpectedAssetKeys = Object.keys(manifest.assets).filter(key => !REQUIRED_PLATFORM_ASSETS[key]);
  if (unexpectedAssetKeys.length > 0) throw new Error(`Unexpected platform assets: ${unexpectedAssetKeys.join(', ')}`);
  for (const command of REQUIRED_ADMIN_COMMANDS) {
    if (!manifest.commandPolicy.admin.includes(command)) throw new Error(`Required management command is not blocked: ${command}`);
  }
  const compatibilityKeys = Object.keys(manifest.compatibilityRecipes ?? {});
  const unknownCompatibilityRecipes = compatibilityKeys.filter(key => key !== 'importViaAtomicBatch');
  if (unknownCompatibilityRecipes.length > 0) {
    throw new Error(`Unreviewed OfficeCLI compatibility recipes: ${unknownCompatibilityRecipes.join(', ')}`);
  }
  const importRecipe = manifest.compatibilityRecipes?.importViaAtomicBatch;
  if (importRecipe && (
    importRecipe.enabled !== true
    || !Number.isInteger(importRecipe.maxSourceBytes)
    || importRecipe.maxSourceBytes <= 0
    || importRecipe.maxSourceBytes > 50_000_000
    || typeof importRecipe.reason !== 'string'
    || importRecipe.reason.trim().length < 20
  )) {
    throw new Error('Invalid OfficeCLI import compatibility recipe declaration');
  }
  const dependencyIdList = manifest.externalDependencies?.map(dependency => dependency.id) ?? [];
  const dependencyIds = new Set(dependencyIdList);
  if (dependencyIds.size !== dependencyIdList.length) throw new Error('Duplicate OfficeCLI external dependency declarations');
  for (const id of REQUIRED_EXTERNAL_DEPENDENCIES) {
    if (!dependencyIds.has(id)) throw new Error(`Missing reviewed external dependency: ${id}`);
  }
  const unexpectedDependencies = [...dependencyIds].filter(id => !REQUIRED_EXTERNAL_DEPENDENCIES.has(id));
  if (unexpectedDependencies.length > 0) {
    throw new Error(`Unreviewed OfficeCLI external dependencies: ${unexpectedDependencies.join(', ')}`);
  }
  for (const dependency of manifest.externalDependencies ?? []) {
    if (!dependency.version || !dependency.license || !dependency.fallback || dependency.networkRequiredFor.length === 0) {
      throw new Error(`Incomplete external dependency declaration: ${dependency.id}`);
    }
    if (dependency.hosts.length === 0 || dependency.hosts.some(host => !REVIEWED_EXTERNAL_HOSTS.has(host))) {
      throw new Error(`Unreviewed external dependency host for ${dependency.id}: ${dependency.hosts.join(', ')}`);
    }
  }
  const edit = new Set(manifest.commandPolicy.edit);
  for (const category of ['read', 'preview', 'lifecycle', 'admin'] as const) {
    for (const command of manifest.commandPolicy[category]) {
      if (edit.has(command)) throw new Error(`Write command classification overlaps ${category}: ${command}`);
    }
  }
  if (
    manifest.license.licenseFile !== `${manifest.version}/LICENSE`
    || manifest.license.noticeFile !== `${manifest.version}/NOTICE`
  ) {
    throw new Error('OfficeCLI license paths must stay inside the pinned version directory');
  }
  const licensePath = join(officeRoot, manifest.license.licenseFile);
  const noticePath = join(officeRoot, manifest.license.noticeFile);
  if (textFileHash(licensePath) !== manifest.license.licenseSha256) throw new Error('LICENSE hash mismatch');
  if (textFileHash(noticePath) !== manifest.license.noticeSha256) throw new Error('NOTICE hash mismatch');
  for (const [name, definition] of Object.entries(manifest.guides)) {
    const root = join(versionRoot, 'skills', definition.directory);
    const entry = join(root, definition.entry);
    if (fileHash(entry) !== definition.contentHash) throw new Error(`Guide entry hash mismatch: ${name}`);
    if (directoryHash(root) !== definition.resourceHash) throw new Error(`Guide resource hash mismatch: ${name}`);
    for (const path of filesRecursively(root)) {
      const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
      if (!SAFE_GUIDE_EXTENSIONS.has(extension)) throw new Error(`Executable or unreviewed guide resource shipped: ${path}`);
    }
  }
  if (!manifest.commandSchema || !manifest.guideIndex) throw new Error('Manifest is missing commandSchema/guideIndex governance records');
  if (
    manifest.commandSchema.file !== `${manifest.version}/command-schema.json`
    || manifest.guideIndex.file !== `${manifest.version}/guide-index.json`
  ) {
    throw new Error('OfficeCLI governance files must stay inside the pinned version directory');
  }
  const commandPath = join(officeRoot, manifest.commandSchema.file);
  const guidePath = join(officeRoot, manifest.guideIndex.file);
  if (fileHash(commandPath) !== manifest.commandSchema.sha256) throw new Error('command-schema.json hash mismatch');
  if (fileHash(guidePath) !== manifest.guideIndex.sha256) throw new Error('guide-index.json hash mismatch');
  const snapshot = json<CommandSnapshot>(commandPath);
  const diff = classificationDiff(manifest, snapshot);
  if (JSON.stringify(diff.unclassifiedCommands) !== JSON.stringify(manifest.commandSchema.unclassifiedCommands)) {
    throw new Error('Manifest unclassifiedCommands does not match command snapshot');
  }
  if (JSON.stringify(diff.staleClassifications) !== JSON.stringify(manifest.commandSchema.staleClassifications)) {
    throw new Error('Manifest staleClassifications does not match command snapshot');
  }
  if (!options.allowCommandPolicyDrift) {
    if (diff.unclassifiedCommands.length > 0) throw new Error(`Unclassified OfficeCLI commands: ${diff.unclassifiedCommands.join(', ')}`);
    if (diff.staleClassifications.length > 0) throw new Error(`Stale OfficeCLI command classifications: ${diff.staleClassifications.join(', ')}`);
  }
  const guideIndex = json<GuideIndex>(guidePath);
  if (JSON.stringify(guideIndex) !== JSON.stringify(buildGuideIndex(manifest, versionRoot))) {
    throw new Error('guide-index.json is stale');
  }
}

function localRuntimePath(): string | undefined {
  const platformKey = `${process.platform}-${process.arch}`;
  const name = process.platform === 'win32' ? 'officecli.exe' : 'officecli';
  const candidate = join(repoRoot, 'apps/electron/resources/bin', platformKey, name);
  return existsSync(candidate) ? candidate : undefined;
}

async function download(url: string, path: string): Promise<void> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:'
    || !REVIEWED_DOWNLOAD_HOSTS.has(parsed.hostname)
    || parsed.username
    || parsed.password
  ) {
    throw new Error(`OfficeCLI download URL is outside the reviewed GitHub hosts: ${url}`);
  }
  const headers: Record<string, string> = { 'User-Agent': 'Selection-OfficeCLI-Sync' };
  if (process.env.GITHUB_TOKEN && parsed.hostname === 'github.com') {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

async function githubJson<T>(url: string): Promise<T> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.github.com' || parsed.username || parsed.password) {
    throw new Error(`GitHub API URL is outside api.github.com: ${url}`);
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Selection-OfficeCLI-Sync',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub API failed (${response.status}): ${url}`);
  return response.json() as Promise<T>;
}

async function tagCommit(tag: string): Promise<string> {
  let object = (await githubJson<{ object: { type: string; sha: string; url: string } }>(
    `https://api.github.com/repos/iOfficeAI/OfficeCLI/git/ref/tags/${encodeURIComponent(tag)}`,
  )).object;
  if (object.type === 'tag') {
    object = (await githubJson<{ object: { type: string; sha: string; url: string } }>(object.url)).object;
  }
  if (object.type !== 'commit') throw new Error(`Tag ${tag} does not resolve to a commit`);
  if (!/^[0-9a-f]{40}$/i.test(object.sha)) throw new Error(`Tag ${tag} resolved to an invalid commit SHA: ${object.sha}`);
  return object.sha;
}

function parseChecksumFile(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (!match) continue;
    const name = match[2]!;
    if (values.has(name)) throw new Error(`Duplicate checksum entry: ${name}`);
    values.set(name, match[1]!.toLowerCase());
  }
  return values;
}

function copySafeGuide(source: string, destination: string): void {
  for (const path of filesRecursively(source)) {
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    if (!SAFE_GUIDE_EXTENSIONS.has(extension)) continue;
    const target = join(destination, relative(source, path));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(path, target);
  }
}

function arrayDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter(value => !beforeSet.has(value)),
    removed: before.filter(value => !afterSet.has(value)),
  };
}

function sourceConstant(sourceRoot: string, relativePath: string, name: string): string {
  const path = join(sourceRoot, relativePath);
  if (!existsSync(path)) throw new Error(`Tag source is missing dependency declaration: ${relativePath}`);
  const source = readFileSync(path, 'utf8');
  const match = new RegExp(`(?:public\\s+)?(?:private\\s+)?const\\s+string\\s+${name}\\s*=\\s*"([^"]+)"`).exec(source);
  if (!match?.[1]) throw new Error(`Could not extract ${name} from ${relativePath}`);
  return match[1];
}

export function extractExternalDependencies(sourceRoot: string): OfficecliManifest['externalDependencies'] {
  // Git paths are case-sensitive in the Linux-only upgrade workflow. The
  // upstream project directory is `src/officecli`, even though its namespace
  // and product name use the `OfficeCLI` casing.
  const katex = sourceConstant(sourceRoot, 'src/officecli/Core/KatexAssets.cs', 'Version');
  const three = sourceConstant(sourceRoot, 'src/officecli/Core/ThreeAssets.cs', 'Version');
  const mermaidSource = 'src/officecli/Core/Diagram/MermaidImageRenderer.cs';
  const mermaid = sourceConstant(sourceRoot, mermaidSource, 'MermaidVersion');
  const elk = sourceConstant(sourceRoot, mermaidSource, 'ElkVersion');
  return [
    {
      id: 'katex', version: katex, license: 'MIT',
      networkRequiredFor: ['HTML equation layout and fonts'],
      fallback: 'plain-text equation rendering',
      hosts: ['d.officecli.ai', 'cdn.jsdelivr.net'],
    },
    {
      id: 'three', version: three, license: 'MIT',
      networkRequiredFor: ['interactive HTML rendering of embedded 3D models'],
      fallback: 'static poster or missing interactive 3D layer',
      hosts: ['d.officecli.ai', 'cdn.jsdelivr.net'],
    },
    {
      id: 'mermaid', version: mermaid, license: 'MIT',
      networkRequiredFor: ['first high-fidelity diagram image render', 'styled Mermaid ESM render'],
      fallback: 'cached UMD renderer or native editable shapes',
      hosts: ['d.officecli.ai', 'cdn.jsdelivr.net'],
    },
    {
      id: 'mermaid-layout-elk', version: elk, license: 'MIT',
      networkRequiredFor: ['styled Mermaid ELK layout'],
      fallback: 'native or Dagre diagram layout',
      hosts: ['cdn.jsdelivr.net'],
    },
  ];
}

function buildReport(
  oldManifest: OfficecliManifest,
  oldCommands: CommandSnapshot | undefined,
  oldGuides: GuideIndex | undefined,
  manifest: OfficecliManifest,
  commands: CommandSnapshot,
  guides: GuideIndex,
): string {
  const commandDiff = arrayDiff(oldCommands?.rootCommands ?? [], commands.rootCommands);
  const flagChanges = commands.rootCommands.flatMap(command => {
    const diff = arrayDiff(oldCommands?.commands[command]?.flags ?? [], commands.commands[command]?.flags ?? []);
    return diff.added.length || diff.removed.length ? [{ command, ...diff }] : [];
  });
  const guideChanges = Object.keys(guides.guides).flatMap(name => {
    const before = (oldGuides?.guides[name]?.headings ?? []).map(item => `${item.level}:${item.title}`);
    const after = guides.guides[name]!.headings.map(item => `${item.level}:${item.title}`);
    const diff = arrayDiff(before, after);
    const assets = arrayDiff(
      (oldGuides?.guides[name]?.files ?? []).map(item => item.path),
      guides.guides[name]!.files.map(item => item.path),
    );
    const beforeFiles = new Map((oldGuides?.guides[name]?.files ?? []).map(item => [item.path, item]));
    const changed = guides.guides[name]!.files.flatMap(item => {
      const before = beforeFiles.get(item.path);
      return before && before.sha256 !== item.sha256
        ? [{ path: item.path, beforeSha256: before.sha256, afterSha256: item.sha256 }]
        : [];
    });
    return diff.added.length || diff.removed.length || assets.added.length || assets.removed.length || changed.length
      ? [{ name, headings: diff, assets: { ...assets, changed } }]
      : [];
  });
  const platformKeys = Object.keys(manifest.assets).sort();
  const platformDiff = {
    ...arrayDiff(Object.keys(oldManifest.assets).sort(), platformKeys),
    changed: platformKeys.flatMap(key => {
      const before = oldManifest.assets[key];
      const after = manifest.assets[key]!;
      return before && JSON.stringify(before) !== JSON.stringify(after)
        ? [{ key, before, after }]
        : [];
    }),
  };
  const dependencyChanges = manifest.externalDependencies.flatMap(dependency => {
    const before = oldManifest.externalDependencies?.find(item => item.id === dependency.id);
    return before?.version === dependency.version && before.license === dependency.license
      ? []
      : [{ id: dependency.id, before: before?.version ?? null, after: dependency.version, license: dependency.license }];
  });
  return `# OfficeCLI 升级差异报告

- 旧版本：${oldManifest.version} (${oldManifest.schemaCrc})
- 新版本：${manifest.version} (${manifest.schemaCrc})
- 上游 tag commit：${manifest.tagCommit}
- 未分类命令：${manifest.commandSchema?.unclassifiedCommands.join(', ') || '无'}
- 过期分类：${manifest.commandSchema?.staleClassifications.join(', ') || '无'}

## 命令

\`\`\`json
${JSON.stringify({ ...commandDiff, flagChanges }, null, 2)}
\`\`\`

## Guides 与资源

\`\`\`json
${JSON.stringify(guideChanges, null, 2)}
\`\`\`

## 平台资产

\`\`\`json
${JSON.stringify(platformDiff, null, 2)}
\`\`\`

## 外部渲染依赖

\`\`\`json
${JSON.stringify(dependencyChanges, null, 2)}
\`\`\`

## 需要复验的兼容 Recipe

\`\`\`json
${JSON.stringify(manifest.compatibilityRecipes ?? {}, null, 2)}
\`\`\`

> 此报告只用于人工审查。运行时自更新保持禁用，draft PR 不会自动合并。
`;
}

async function snapshotCurrent(): Promise<void> {
  const manifest = json<OfficecliManifest>(manifestPath);
  const binary = localRuntimePath();
  if (!binary) throw new Error(`No local OfficeCLI binary for ${process.platform}-${process.arch}`);
  const snapshot = await buildCommandSnapshot(binary);
  if (snapshot.version !== manifest.version || snapshot.schemaCrc !== manifest.schemaCrc) {
    throw new Error(`Local binary ${snapshot.version}/${snapshot.schemaCrc} does not match manifest ${manifest.version}/${manifest.schemaCrc}`);
  }
  const versionRoot = join(officeRoot, manifest.version);
  const guideIndex = buildGuideIndex(manifest, versionRoot);
  const commandFile = join(versionRoot, 'command-schema.json');
  const guideFile = join(versionRoot, 'guide-index.json');
  writeJson(commandFile, snapshot);
  writeJson(guideFile, guideIndex);
  const diff = classificationDiff(manifest, snapshot);
  manifest.commandSchema = {
    file: relative(officeRoot, commandFile),
    sha256: fileHash(commandFile),
    ...diff,
  };
  manifest.guideIndex = { file: relative(officeRoot, guideFile), sha256: fileHash(guideFile) };
  writeJson(manifestPath, manifest);
  writeFileSync(reportPath, buildReport(manifest, snapshot, guideIndex, manifest, snapshot, guideIndex));
  validateManifestFiles(manifest);
  console.log(`OfficeCLI ${manifest.version} governance snapshots generated.`);
}

async function check(downloadRuntime: boolean): Promise<void> {
  const manifest = json<OfficecliManifest>(manifestPath);
  validateManifestFiles(manifest);
  let binary = localRuntimePath();
  let temp: string | undefined;
  if (!binary && downloadRuntime) {
    temp = mkdtempSync(join(tmpdir(), 'selection-officecli-check-'));
    const key = `${process.platform}-${process.arch}`;
    const asset = manifest.assets[key];
    if (!asset) throw new Error(`No reviewed OfficeCLI asset for ${key}`);
    binary = join(temp, asset.name);
    await download(asset.url, binary);
    if (fileHash(binary) !== asset.sha256) throw new Error(`Downloaded ${key} asset SHA256 mismatch`);
    if (process.platform !== 'win32') chmodSync(binary, 0o755);
  }
  try {
    if (binary) {
      const snapshot = await buildCommandSnapshot(binary);
      const reviewed = json<CommandSnapshot>(join(officeRoot, manifest.commandSchema!.file));
      if (!commandSchemaContractsEqual(snapshot, reviewed)) {
        throw new Error(
          'Reviewed command schema contract differs from the current platform binary (version, schemaCrc, commands, or flags)',
        );
      }
      const key = `${process.platform}-${process.arch}`;
      const expected = manifest.assets[key]?.sha256;
      if (expected && fileHash(binary) !== expected) throw new Error(`Local ${key} binary hash differs from manifest`);
    }
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
  console.log(`OfficeCLI ${manifest.version} manifest, resources, policy, schema, and guides are consistent.`);
}

async function prepareRuntime(): Promise<void> {
  const manifest = json<OfficecliManifest>(manifestPath);
  validateManifestFiles(manifest);
  const key = `${process.platform}-${process.arch}`;
  const asset = manifest.assets[key];
  if (!asset) throw new Error(`No reviewed OfficeCLI asset for ${key}`);
  const name = process.platform === 'win32' ? 'officecli.exe' : 'officecli';
  const destination = join(repoRoot, 'apps/electron/resources/bin', key, name);
  if (!existsSync(destination) || fileHash(destination) !== asset.sha256) {
    validateOfficecliReleaseAssetUrl(manifest.tag, asset.name, asset.url);
    mkdirSync(dirname(destination), { recursive: true });
    const suffix = `${process.pid}-${Date.now()}`;
    const staged = `${destination}.download-${suffix}`;
    const backup = `${destination}.backup-${suffix}`;
    let backedUp = false;
    let installed = false;
    try {
      await download(asset.url, staged);
      if (fileHash(staged) !== asset.sha256) throw new Error(`Downloaded ${key} asset SHA256 mismatch`);
      if (process.platform !== 'win32') chmodSync(staged, 0o755);
      if (existsSync(destination)) {
        renameSync(destination, backup);
        backedUp = true;
      }
      renameSync(staged, destination);
      installed = true;
      if (fileHash(destination) !== asset.sha256) throw new Error(`Prepared ${key} asset SHA256 mismatch`);
      if (backedUp) rmSync(backup, { force: true });
    } catch (error) {
      try {
        if (existsSync(staged)) rmSync(staged, { force: true });
        if (installed && existsSync(destination)) rmSync(destination, { force: true });
        if (backedUp && existsSync(backup)) {
          renameSync(backup, destination);
        }
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'OfficeCLI runtime preparation failed and rollback was incomplete');
      }
      throw error;
    }
  }
  if (fileHash(destination) !== asset.sha256) throw new Error(`Prepared ${key} asset SHA256 mismatch`);
  if (process.platform !== 'win32') chmodSync(destination, 0o755);
  writeFileSync(join(dirname(destination), 'officecli.version'), `${manifest.tag}\n`);
  console.log(`OfficeCLI ${manifest.version} prepared at ${destination}.`);
}

async function update(allowUnclassified: boolean): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('OfficeCLI release synchronization must run on Linux x64 so the reviewed Linux binary generates the canonical schema.');
  }
  const oldManifest = json<OfficecliManifest>(manifestPath);
  const oldCommands = oldManifest.commandSchema && existsSync(join(officeRoot, oldManifest.commandSchema.file))
    ? json<CommandSnapshot>(join(officeRoot, oldManifest.commandSchema.file)) : undefined;
  const oldGuides = oldManifest.guideIndex && existsSync(join(officeRoot, oldManifest.guideIndex.file))
    ? json<GuideIndex>(join(officeRoot, oldManifest.guideIndex.file)) : undefined;
  const release = await githubJson<GithubRelease>('https://api.github.com/repos/iOfficeAI/OfficeCLI/releases/latest');
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error(`Latest GitHub release is not a stable semver tag: ${release.tag_name}`);
  }
  const version = release.tag_name.slice(1);
  const temp = mkdtempSync(join(tmpdir(), 'selection-officecli-sync-'));
  try {
    const checksumAsset = release.assets.find(asset => asset.name === 'SHA256SUMS');
    if (!checksumAsset) throw new Error('Release is missing SHA256SUMS');
    validateOfficecliReleaseAssetUrl(release.tag_name, checksumAsset.name, checksumAsset.browser_download_url);
    const checksumPath = join(temp, 'SHA256SUMS');
    await download(checksumAsset.browser_download_url, checksumPath);
    const checksums = parseChecksumFile(readFileSync(checksumPath, 'utf8'));
    const assets: OfficecliManifest['assets'] = {};
    for (const [key, name] of Object.entries(REQUIRED_PLATFORM_ASSETS)) {
      const releaseAsset = release.assets.find(asset => asset.name === name);
      const checksum = checksums.get(name);
      if (!releaseAsset || !checksum) throw new Error(`Release is missing platform asset or checksum: ${name}`);
      validateOfficecliReleaseAssetUrl(release.tag_name, name, releaseAsset.browser_download_url);
      assets[key] = { name, url: releaseAsset.browser_download_url, sha256: checksum };
    }
    const linuxBinary = join(temp, REQUIRED_PLATFORM_ASSETS['linux-x64']);
    await download(assets['linux-x64']!.url, linuxBinary);
    if (fileHash(linuxBinary) !== assets['linux-x64']!.sha256) throw new Error('Linux x64 release binary hash mismatch');
    chmodSync(linuxBinary, 0o755);
    const commandSnapshot = await buildCommandSnapshot(linuxBinary);
    if (commandSnapshot.version !== version) throw new Error(`Release tag/binary version mismatch: ${version}/${commandSnapshot.version}`);

    const resolvedTagCommit = await tagCommit(release.tag_name);
    const tarball = join(temp, 'source.tar.gz');
    await download(`https://codeload.github.com/iOfficeAI/OfficeCLI/tar.gz/${resolvedTagCommit}`, tarball);
    const extracted = join(temp, 'source');
    mkdirSync(extracted);
    await run('tar', ['-xzf', tarball, '-C', extracted]);
    const sourceRoot = join(extracted, readdirSync(extracted)[0]!);
    const stagedVersion = join(temp, 'staged', version);
    mkdirSync(join(stagedVersion, 'skills'), { recursive: true });
    for (const definition of Object.values(GUIDE_LAYOUT)) {
      const source = join(sourceRoot, 'skills', definition.directory);
      if (!existsSync(source)) throw new Error(`Tag source is missing guide: ${definition.directory}`);
      copySafeGuide(source, join(stagedVersion, 'skills', definition.directory));
    }
    cpSync(join(sourceRoot, 'LICENSE'), join(stagedVersion, 'LICENSE'));
    cpSync(join(sourceRoot, 'NOTICE'), join(stagedVersion, 'NOTICE'));
    const guides = Object.fromEntries(Object.entries(GUIDE_LAYOUT).map(([name, definition]) => {
      const root = join(stagedVersion, 'skills', definition.directory);
      return [name, {
        ...definition,
        contentHash: fileHash(join(root, definition.entry)),
        resourceHash: directoryHash(root),
      }];
    })) as Record<GuideName, ManifestGuide>;
    const manifest: OfficecliManifest = {
      manifestVersion: 1,
      version,
      tag: release.tag_name,
      tagCommit: resolvedTagCommit,
      schemaCrc: commandSnapshot.schemaCrc,
      sourceRepository: oldManifest.sourceRepository,
      license: {
        spdx: 'Apache-2.0',
        licenseFile: `${version}/LICENSE`,
        licenseSha256: fileHash(join(stagedVersion, 'LICENSE')),
        noticeFile: `${version}/NOTICE`,
        noticeSha256: fileHash(join(stagedVersion, 'NOTICE')),
      },
      assets,
      commandPolicy: oldManifest.commandPolicy,
      compatibilityRecipes: oldManifest.compatibilityRecipes,
      externalDependencies: extractExternalDependencies(sourceRoot),
      guides,
    };
    const guideIndex = buildGuideIndex(manifest, stagedVersion);
    const commandFile = join(stagedVersion, 'command-schema.json');
    const guideFile = join(stagedVersion, 'guide-index.json');
    writeJson(commandFile, commandSnapshot);
    writeJson(guideFile, guideIndex);
    const diff = classificationDiff(manifest, commandSnapshot);
    manifest.commandSchema = {
      file: `${version}/command-schema.json`,
      sha256: fileHash(commandFile),
      ...diff,
    };
    manifest.guideIndex = { file: `${version}/guide-index.json`, sha256: fileHash(guideFile) };
    if (!allowUnclassified && (diff.unclassifiedCommands.length || diff.staleClassifications.length)) {
      throw new Error(`Command policy review required: ${JSON.stringify(diff)}`);
    }
    const report = buildReport(oldManifest, oldCommands, oldGuides, manifest, commandSnapshot, guideIndex);

    const destination = join(officeRoot, version);
    const backup = join(officeRoot, `.backup-${version}-${Date.now()}`);
    const previousManifest = readFileSync(manifestPath);
    const previousReport = existsSync(reportPath) ? readFileSync(reportPath) : undefined;
    let backedUp = false;
    try {
      if (existsSync(destination)) {
        renameSync(destination, backup);
        backedUp = true;
      }
      cpSync(stagedVersion, destination, { recursive: true });
      writeJson(manifestPath, manifest);
      writeFileSync(reportPath, report);
      validateManifestFiles(manifest, { allowCommandPolicyDrift: allowUnclassified });
      if (backedUp) rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      try {
        if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
        if (backedUp && existsSync(backup)) renameSync(backup, destination);
        writeFileSync(manifestPath, previousManifest);
        if (previousReport !== undefined) writeFileSync(reportPath, previousReport);
        else rmSync(reportPath, { force: true });
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'OfficeCLI update failed and rollback was incomplete');
      }
      throw error;
    }
    console.log(`OfficeCLI ${version} resources synchronized. Policy review: ${JSON.stringify(diff)}`);
    if (process.env.GITHUB_OUTPUT) {
      writeFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`, { flag: 'a' });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--snapshot-current')) await snapshotCurrent();
  else if (args.has('--update')) await update(args.has('--allow-unclassified'));
  else if (args.has('--check')) await check(args.has('--download-runtime'));
  else if (args.has('--prepare-runtime')) await prepareRuntime();
  else {
    console.error('Usage: bun scripts/sync-officecli.ts --check [--download-runtime] | --prepare-runtime | --snapshot-current | --update [--allow-unclassified]');
    process.exitCode = 2;
  }
}
