import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getBundledAssetsDir } from './paths.ts';

export type OfficecliBinarySource =
  | 'environment'
  | 'electron-resources'
  | 'server-resources'
  | 'development';

export interface ResolvedOfficecliBinary {
  path: string;
  source: OfficecliBinarySource;
}

export interface ResolveOfficecliOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

const MANIFEST_NAME = 'officecli-manifest.json';

export function officecliBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'officecli.exe' : 'officecli';
}

function isFile(path: string | undefined): path is string {
  if (!path || !existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string | undefined): path is string {
  if (!path || !existsSync(path)) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the app-managed OfficeCLI binary without consulting the user's PATH.
 */
export function resolveOfficecliRuntime(
  options: ResolveOfficecliOptions = {},
): ResolvedOfficecliBinary | undefined {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const name = officecliBinaryName(platform);
  const platformKey = `${platform}-${arch}`;

  const candidates: Array<ResolvedOfficecliBinary> = [];
  if (env.CRAFT_OFFICECLI) {
    candidates.push({ path: env.CRAFT_OFFICECLI, source: 'environment' });
  }

  if (env.CRAFT_RESOURCES_BASE) {
    candidates.push(
      {
        path: join(env.CRAFT_RESOURCES_BASE, 'resources', 'bin', platformKey, name),
        source: 'electron-resources',
      },
      {
        path: join(env.CRAFT_RESOURCES_BASE, 'resources', 'bin', name),
        source: 'electron-resources',
      },
    );
  }

  for (const root of [env.CRAFT_BUNDLED_ASSETS_ROOT, env.CRAFT_RESOURCES_PATH]) {
    if (!root) continue;
    candidates.push(
      { path: join(root, 'resources', 'bin', name), source: 'server-resources' },
      { path: join(root, 'resources', 'bin', platformKey, name), source: 'server-resources' },
      { path: join(root, 'bin', name), source: 'server-resources' },
      { path: join(root, 'bin', platformKey, name), source: 'server-resources' },
    );
  }

  candidates.push(
    { path: join(cwd, 'resources', 'bin', platformKey, name), source: 'development' },
    { path: join(cwd, 'resources', 'bin', name), source: 'development' },
    { path: join(cwd, 'dist', 'resources', 'bin', platformKey, name), source: 'development' },
    {
      path: join(cwd, 'apps', 'electron', 'resources', 'bin', platformKey, name),
      source: 'development',
    },
    {
      path: join(cwd, '..', '..', 'apps', 'electron', 'resources', 'bin', platformKey, name),
      source: 'development',
    },
  );

  return candidates
    .map(candidate => ({ ...candidate, path: resolve(cwd, candidate.path) }))
    .find(candidate => isFile(candidate.path));
}

export function resolveOfficecliBinary(options?: ResolveOfficecliOptions): string | undefined {
  return resolveOfficecliRuntime(options)?.path;
}

function packagedOfficecliRoots(base: string): string[] {
  return [
    join(base, 'dist', 'resources', 'officecli'),
    join(base, 'resources', 'officecli'),
    join(base, 'officecli'),
  ];
}

/**
 * Directory that contains officecli-manifest.json.
 */
export function resolveOfficecliResourcesRoot(options: ResolveOfficecliOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const roots: string[] = [];

  if (env.CRAFT_OFFICECLI_RESOURCES) roots.push(env.CRAFT_OFFICECLI_RESOURCES);
  if (env.CRAFT_RESOURCES_BASE) roots.push(...packagedOfficecliRoots(env.CRAFT_RESOURCES_BASE));
  for (const base of [env.CRAFT_BUNDLED_ASSETS_ROOT, env.CRAFT_RESOURCES_PATH]) {
    if (base) roots.push(...packagedOfficecliRoots(base));
  }
  roots.push(
    join(cwd, 'apps', 'electron', 'resources', 'officecli'),
    join(cwd, 'resources', 'officecli'),
    join(cwd, '..', '..', 'apps', 'electron', 'resources', 'officecli'),
  );

  return [...new Set(roots.map(root => resolve(root)))]
    .find(root => isFile(join(root, MANIFEST_NAME)));
}

/** Official OfficeCLI skill slugs shipped under `resources/officecli/<version>/skills`. */
export const BUNDLED_OFFICECLI_SKILL_SLUGS = [
  'officecli-docx',
  'officecli-xlsx',
  'officecli-pptx',
  'officecli-academic-paper',
  'officecli-financial-model',
  'officecli-data-dashboard',
  'officecli-pitch-deck',
  'officecli-word-form',
  'morph-ppt',
  'morph-ppt-3d',
] as const;

export type OfficeFormatSkillSlug = 'officecli-docx' | 'officecli-xlsx' | 'officecli-pptx';

const OFFICE_FORMAT_SKILL_PATTERNS: Array<{ re: RegExp; slug: OfficeFormatSkillSlug }> = [
  { re: /\.xlsx\b|\.xlsm\b|\bxlsx\b|\bxlsm\b|\bexcel\b|电子表格/i, slug: 'officecli-xlsx' },
  { re: /\.pptx\b|\bpptx\b|\bppt\b|\bpowerpoint\b|幻灯片|演示文稿/i, slug: 'officecli-pptx' },
  { re: /\.docx\b|\bdocx\b|\bword\b|word文档|word报告|微软\s*word/i, slug: 'officecli-docx' },
];

const AGENTS_OFFICE_SKILL_RE =
  /(?:^|[\\/])\.agents[\\/]skills[\\/](officecli-(?:docx|xlsx|pptx)|officecli|docx|xlsx|pptx)(?:[\\/]SKILL\.md)?$/i;

function addOfficeFormatSkillSlugs(text: string, slugs: Set<OfficeFormatSkillSlug>): void {
  for (const { re, slug } of OFFICE_FORMAT_SKILL_PATTERNS) {
    if (re.test(text)) slugs.add(slug);
  }
}

/**
 * Format skills to load when the user attaches or names an Office file,
 * or asks to create a Word / Excel / PowerPoint artifact.
 * Specialized skills (academic paper, morph, …) are not inferred.
 */
export function collectOfficeFormatSkillSlugs(
  message: string,
  attachments?: Array<{ type?: string; name?: string; path?: string; storedPath?: string }>,
): OfficeFormatSkillSlug[] {
  const slugs = new Set<OfficeFormatSkillSlug>();
  addOfficeFormatSkillSlugs(message, slugs);

  for (const attachment of attachments ?? []) {
    const hint = [attachment.name, attachment.path, attachment.storedPath].filter(Boolean).join(' ');
    const before = slugs.size;
    addOfficeFormatSkillSlugs(hint, slugs);
    if (attachment.type === 'office' && slugs.size === before) {
      slugs.add('officecli-docx');
    }
  }

  return [...slugs];
}

function expandUserPath(filePath: string): string {
  if (filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2));
  return filePath;
}

function getAppBundledSkillsDir(): string | undefined {
  const fromAssets = getBundledAssetsDir('skills');
  if (fromAssets) return fromAssets;
  const candidates = [
    join(process.cwd(), 'apps', 'electron', 'resources', 'skills'),
    join(process.cwd(), 'resources', 'skills'),
    join(process.cwd(), '..', '..', 'apps', 'electron', 'resources', 'skills'),
  ];
  return candidates.find(dir => isDirectory(dir));
}

/** App-owned `officecli` router skill. Overrides `~/.agents/skills/officecli`. */
export function getBundledOfficecliRouterSkillMd(): string | undefined {
  const dir = getAppBundledSkillsDir();
  if (!dir) return undefined;
  const skillMd = join(dir, 'officecli', 'SKILL.md');
  return isFile(skillMd) ? skillMd : undefined;
}

function bundledSkillMdForAgentsSlug(slug: string): string | undefined {
  if (slug === 'officecli') return getBundledOfficecliRouterSkillMd();

  const formatSlug: OfficeFormatSkillSlug | undefined =
    slug === 'docx' || slug === 'officecli-docx'
      ? 'officecli-docx'
      : slug === 'xlsx' || slug === 'officecli-xlsx'
        ? 'officecli-xlsx'
        : slug === 'pptx' || slug === 'officecli-pptx'
          ? 'officecli-pptx'
          : undefined;
  if (!formatSlug) return undefined;

  const skillsDir = getBundledOfficecliSkillsDir();
  if (!skillsDir) return undefined;
  const bundled = join(skillsDir, formatSlug, 'SKILL.md');
  return isFile(bundled) ? bundled : undefined;
}

/**
 * Send Reads of `~/.agents/skills/officecli` (and docx/xlsx/pptx) to the
 * bundled skill, even when the global file exists.
 */
export function resolveBundledOfficecliSkillRead(requestedPath: string): string | undefined {
  const expanded = expandUserPath(requestedPath);
  const match = expanded.match(AGENTS_OFFICE_SKILL_RE);
  if (!match) return undefined;

  const bundled = bundledSkillMdForAgentsSlug(match[1]!.toLowerCase());
  if (!bundled || resolve(expanded) === resolve(bundled)) return undefined;
  return bundled;
}

/** @deprecated Use resolveBundledOfficecliSkillRead */
export function resolveMissingBundledOfficecliSkillRead(requestedPath: string): string | undefined {
  return resolveBundledOfficecliSkillRead(requestedPath);
}

/**
 * Official OfficeCLI SKILL.md folders shipped with the app (version-pinned).
 */
export function getBundledOfficecliSkillsDir(options?: ResolveOfficecliOptions): string | undefined {
  const root = resolveOfficecliResourcesRoot(options);
  if (!root) return undefined;

  try {
    const manifest = JSON.parse(readFileSync(join(root, MANIFEST_NAME), 'utf8')) as { version?: string };
    if (!manifest.version) return undefined;
    const skillsDir = join(root, manifest.version, 'skills');
    return isDirectory(skillsDir) ? skillsDir : undefined;
  } catch {
    return undefined;
  }
}
