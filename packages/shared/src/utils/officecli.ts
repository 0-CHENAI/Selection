import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
  /** Trusted host roots supplied by the application shell. */
  appRootPath?: string;
  resourcesPath?: string;
  /** Disable environment overrides when resolving a subprocess toolchain. */
  trustEnvironment?: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
}

const MANIFEST_NAME = 'officecli-manifest.json';

export function officecliBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'officecli.exe' : 'officecli';
}

export function officecliWrapperName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'officecli.cmd' : 'officecli';
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

function isFileWithin(path: string, roots: string[]): boolean {
  if (!isFile(path)) return false;
  try {
    const target = realpathSync.native(path);
    return roots.some(root => {
      try {
        if (!isDirectory(root)) return false;
        const base = realpathSync.native(root);
        const rel = relative(base, target);
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      } catch {
        // One missing or unreadable trusted root must not invalidate the rest.
        return false;
      }
    });
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
  if (options.trustEnvironment !== false && env.CRAFT_OFFICECLI) {
    candidates.push({ path: env.CRAFT_OFFICECLI, source: 'environment' });
  }

  if (options.trustEnvironment !== false && env.CRAFT_RESOURCES_BASE) {
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

  for (const root of options.trustEnvironment === false ? [] : [env.CRAFT_BUNDLED_ASSETS_ROOT, env.CRAFT_RESOURCES_PATH]) {
    if (!root) continue;
    candidates.push(
      { path: join(root, 'resources', 'bin', name), source: 'server-resources' },
      { path: join(root, 'resources', 'bin', platformKey, name), source: 'server-resources' },
      { path: join(root, 'bin', name), source: 'server-resources' },
      { path: join(root, 'bin', platformKey, name), source: 'server-resources' },
    );
  }

  const trustedRoots = [options.resourcesPath, options.appRootPath].filter((value): value is string => !!value).map(root => resolve(root));
  for (const root of trustedRoots) {
    candidates.push(
      { path: join(root, 'resources', 'bin', platformKey, name), source: 'electron-resources' },
      { path: join(root, 'resources', 'bin', name), source: 'electron-resources' },
      { path: join(root, 'bin', platformKey, name), source: 'electron-resources' },
      { path: join(root, 'bin', name), source: 'electron-resources' },
      { path: join(root, 'apps', 'electron', 'resources', 'bin', platformKey, name), source: 'development' },
    );
  }
  if (trustedRoots.length === 0) {
    candidates.push(
      { path: join(cwd, 'resources', 'bin', platformKey, name), source: 'development' },
      { path: join(cwd, 'resources', 'bin', name), source: 'development' },
      { path: join(cwd, 'dist', 'resources', 'bin', platformKey, name), source: 'development' },
      { path: join(cwd, 'apps', 'electron', 'resources', 'bin', platformKey, name), source: 'development' },
      { path: join(cwd, '..', '..', 'apps', 'electron', 'resources', 'bin', platformKey, name), source: 'development' },
    );
  }

  return candidates
    .map(candidate => ({ ...candidate, path: resolve(cwd, candidate.path) }))
    .find(candidate => trustedRoots.length > 0
      ? isFileWithin(candidate.path, trustedRoots)
      : isFile(candidate.path));
}

export function resolveOfficecliBinary(options?: ResolveOfficecliOptions): string | undefined {
  return resolveOfficecliRuntime(options)?.path;
}

function packagedOfficecliRoots(base: string): string[] {
  return [
    join(base, 'dist', 'resources', 'officecli'),
    join(base, 'resources', 'officecli'),
    join(base, 'app', 'dist', 'resources', 'officecli'),
    join(base, 'app', 'resources', 'officecli'),
    join(base, 'apps', 'electron', 'resources', 'officecli'),
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
  const trustedRoots = [options.resourcesPath, options.appRootPath]
    .filter((value): value is string => !!value)
    .map(root => resolve(root));

  if (options.trustEnvironment !== false) {
    if (env.CRAFT_OFFICECLI_RESOURCES) roots.push(env.CRAFT_OFFICECLI_RESOURCES);
    for (const base of [env.CRAFT_RESOURCES_BASE, env.CRAFT_BUNDLED_ASSETS_ROOT, env.CRAFT_RESOURCES_PATH]) {
      if (base) roots.push(...packagedOfficecliRoots(base));
    }
  }
  for (const base of trustedRoots) roots.push(...packagedOfficecliRoots(base));
  if (trustedRoots.length === 0) roots.push(...packagedOfficecliRoots(cwd));

  return [...new Set(roots.map(root => resolve(root)))]
    .find(root => {
      const manifest = join(root, MANIFEST_NAME);
      if (!isFile(manifest)) return false;
      return trustedRoots.length === 0 || isFileWithin(manifest, trustedRoots);
    });
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

const OFFICE_FILE_PATTERNS: Array<{ re: RegExp; slug: OfficeFormatSkillSlug }> = [
  { re: /\.(?:xlsx|xlsm|xls)(?!\.md)(?:\b|["'）)\]])/i, slug: 'officecli-xlsx' },
  { re: /\.(?:pptx|ppt)(?!\.md)(?:\b|["'）)\]])/i, slug: 'officecli-pptx' },
  { re: /\.(?:docx|docm|doc)(?!\.md)(?:\b|["'）)\]])/i, slug: 'officecli-docx' },
];

export const BUNDLED_OFFICECLI_LOAD_SKILL_ALIASES = [
  'word', 'excel', 'pptx', 'academic-paper', 'financial-model',
  'data-dashboard', 'pitch-deck', 'word-form', 'morph-ppt', 'morph-ppt-3d',
] as const;

const OFFICECLI_SHELL_COMMAND_RE = /(?:^|[;&|\s])(?:officecli(?:-[\w-]+)?(?:\.(?:exe|cmd))?|["']?\$\{?CRAFT_OFFICECLI\}?["']?|%CRAFT_OFFICECLI%)(?:["'])?\s+/i;

/** Detect bundled OfficeCLI shell calls so a missing packaged runtime fails closed. */
export function isOfficecliShellCommand(command: string): boolean {
  return OFFICECLI_SHELL_COMMAND_RE.test(command)
    || /\bStart-Process\b[^\r\n]*(?:officecli|CRAFT_OFFICECLI)/i.test(command);
}

/** Exact read-only guide loads bypass generic large-output summarization. */
export function isBundledOfficecliLoadSkillCommand(command: string): boolean {
  const aliases = BUNDLED_OFFICECLI_LOAD_SKILL_ALIASES.join('|');
  const exactLoad = new RegExp(`^officecli\\s+load_skill\\s+(?:${aliases})$`, 'i');
  const commands = command.trim().split(/\s*(?:&&|;|\r?\n)\s*/).filter(Boolean);
  return commands.length > 0 && commands.every(item => exactLoad.test(item));
}

const AGENTS_OFFICE_SKILL_RE =
  /(?:^|[\\/])\.agents[\\/]skills[\\/](officecli)(?:[\\/]SKILL\.md)?$/i;

function addOfficeFileSlugs(text: string, slugs: Set<OfficeFormatSkillSlug>): void {
  for (const { re, slug } of OFFICE_FILE_PATTERNS) {
    if (re.test(text)) slugs.add(slug);
  }
}

type OfficeFileHint = {
  type?: string;
  name?: string;
  path?: string;
  storedPath?: string;
};

/**
 * Office files the user already named or attached. Language like
 * "周报" / "markdown" is left to the model — do not infer intent here.
 */
export function collectOfficeFormatSkillSlugs(
  message: string,
  attachments?: OfficeFileHint[],
): OfficeFormatSkillSlug[] {
  const slugs = new Set<OfficeFormatSkillSlug>();
  addOfficeFileSlugs(message, slugs);

  for (const attachment of attachments ?? []) {
    const hint = [attachment.name, attachment.path, attachment.storedPath].filter(Boolean).join(' ');
    addOfficeFileSlugs(hint, slugs);
  }

  return [...slugs];
}

/** Named Office paths, or an attachment the app already classified as Office. */
export function shouldLoadBundledOfficecliRouter(
  message: string,
  attachments?: OfficeFileHint[],
): boolean {
  if (collectOfficeFormatSkillSlugs(message, attachments).length > 0) return true;
  return (attachments ?? []).some((attachment) => attachment.type === 'office');
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
  return slug === 'officecli' ? getBundledOfficecliRouterSkillMd() : undefined;
}

/**
 * Send Reads of `~/.agents/skills/officecli` to the bundled router.
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

const DOCX_PATH_RE = /\.(docx|docm)$/i;
const OFFICECLI_FLAG_RE = /^-/;

export function isOfficeDocxPath(value: string): boolean {
  return DOCX_PATH_RE.test(value);
}

export function findDocxArgInOfficecliArgs(args: string[]): string | undefined {
  return args.find(arg => !OFFICECLI_FLAG_RE.test(arg) && isOfficeDocxPath(arg));
}

function firstOfficecliVerb(args: string[]): string | undefined {
  return args.find(arg => !OFFICECLI_FLAG_RE.test(arg))?.toLowerCase();
}

export interface DocxOutlineEnsureTiming {
  before: boolean;
  after: boolean;
}

/**
 * The transparent PATH wrapper repairs Heading outline levels only after create.
 * All later edits remain native OfficeCLI operations and preserve resident state.
 */
export function docxOutlineEnsureTiming(args: string[]): DocxOutlineEnsureTiming {
  const none = { before: false, after: false };
  if (!findDocxArgInOfficecliArgs(args)) return none;
  return firstOfficecliVerb(args) === 'create' ? { before: false, after: true } : none;
}

export function shouldEnsureDocxOutlineStyles(args: string[]): boolean {
  const timing = docxOutlineEnsureTiming(args);
  return timing.before || timing.after;
}

/** Directory that contains the PATH `officecli` / `officecli.cmd` wrappers. */
export function getOfficecliWrapperDir(options: ResolveOfficecliOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const wrapperName = officecliWrapperName(options.platform ?? process.platform);
  const optionRoots = [options.resourcesPath, options.appRootPath]
    .filter((value): value is string => !!value)
    .map(root => resolve(root));
  const envRoots = options.trustEnvironment !== false && env.CRAFT_RESOURCES_BASE
    ? [resolve(env.CRAFT_RESOURCES_BASE)]
    : [];
  const trustedRoots = optionRoots.length > 0 ? optionRoots : envRoots;
  const candidates = trustedRoots.length > 0
    ? trustedRoots.flatMap(root => [
        join(root, 'resources', 'bin'),
        join(root, 'bin'),
        join(root, 'apps', 'electron', 'resources', 'bin'),
      ])
    : [
        join(cwd, 'apps', 'electron', 'resources', 'bin'),
        join(cwd, 'resources', 'bin'),
        join(cwd, '..', '..', 'apps', 'electron', 'resources', 'bin'),
      ];
  return candidates.find(
    dir => {
      const wrapper = join(dir, wrapperName);
      return trustedRoots.length > 0 ? isFileWithin(wrapper, trustedRoots) : isFile(wrapper);
    },
  );
}
