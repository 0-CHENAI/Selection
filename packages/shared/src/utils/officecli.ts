import { spawnSync } from 'node:child_process';
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

export type OfficecliAttributionPolicy = 'forbid' | 'allow-visible' | 'allow-metadata' | 'allow-all';

/**
 * Derive a narrow attribution policy from the user's own turn text.
 * Topic/edit requests never grant attribution; only explicit credit language,
 * an exact generated-by stamp request, or an explicit preservation request do.
 */
export function getOfficecliAttributionPolicy(message: string): OfficecliAttributionPolicy {
  if (!/office\s*cli/i.test(message)) return 'forbid';

  const preservation = /(?:不要|请勿)(?:删除|移除|去除)[^。！？\n]{0,50}(?:(?:由|使用)\s*office\s*cli\s*(?:自动)?(?:生成|创建|制作)|office\s*cli\s*(?:归因|署名|生成器说明))|(?:保留|保持)[^。！？\n]{0,50}(?:(?:由|使用)\s*office\s*cli\s*(?:自动)?(?:生成|创建|制作)|office\s*cli\s*(?:归因|署名|生成器说明))|(?:do\s+not|don['’]t)\s+(?:remove|delete)[^.\n]{0,60}(?:(?:generated|created|made|powered)\s+(?:by|with)\s+office\s*cli|office\s*cli\s+attribution)|(?:retain|preserve|keep)[^.\n]{0,60}(?:(?:generated|created|made|powered)\s+(?:by|with)\s+office\s*cli|office\s*cli\s+attribution)/is.test(message);
  const prohibition = /(?:不要|不得|禁止|别|请勿)[^。！？\n]{0,30}(?:写|添加|注明|标注|披露|署名|出现|保留)[^。！？\n]{0,40}office\s*cli|(?:删除|移除|去除)[^。！？\n]{0,40}(?:由|使用)?\s*office\s*cli|(?:do\s+not|don['’]t|never)\s+(?:add|include|show|state|write|put|credit|attribute|retain)[^.\n]{0,50}office\s*cli|(?:remove|omit|hide|without)[^.\n]{0,40}office\s*cli/is.test(message);
  const metaQuestion = /(?:为什么|为何|怎么会|如何会|排查|检查|确认|是否已有|是否存在)[^。！？\n]{0,80}(?:由|使用)?\s*office\s*cli|(?:why|how|investigate|check|whether|already)[^.\n]{0,80}(?:generated|created|made|powered)?[^.\n]{0,20}office\s*cli/is.test(message);
  if (!preservation && (prohibition || metaQuestion)) return 'forbid';

  const exactStamp = /(?:由|使用)\s*office\s*cli\s*(?:自动)?(?:生成|创建|制作)|(?:generated|created|made|powered)\s+(?:by|with)\s+office\s*cli/i;
  const creditNoun = /(?:归因|署名|披露|生成器(?:署名|说明|信息)?|工具署名)|(?:attribution|generator\s+credit|tool\s+credit|credit\s+office\s*cli|office\s*cli\s+credit|disclosure)/i;
  const writeExactStamp = /(?:写|写上|写明|注明|标注|放入|加上|添加|保留|保持)[^。！？\n]{0,60}(?:由|使用)\s*office\s*cli\s*(?:自动)?(?:生成|创建|制作)|(?:put|write|add|include|retain|preserve|keep)[^.\n]{0,70}(?:generated|created|made|powered)\s+(?:by|with)\s+office\s*cli/is.test(message);
  // Only creator/author is a supported metadata credit. Treat command examples,
  // documentation prose, and broader app/custom properties as normal research
  // content rather than trusted permission to preserve generator metadata.
  const unsupportedMetadataTarget = /(?:lastmodifiedby|application\s+(?:property|metadata)|custom\s+propert)/i.test(message);
  const metadataExample = /(?:示例|例子|介绍|说明如何|命令示例|technical\s+section|document\s+the\s+command|example|how\s+to)/i.test(message);
  const metadataAssignment = !unsupportedMetadataTarget && !metadataExample && /(?:元数据|文档属性|创建者|作者字段|creator|author|document\s+metadata)[^。！？\n]{0,70}(?:写|设为|设置为|注明|标注|值为|to|as|=)[^。！？\n]{0,30}office\s*cli|(?:set|write|put)[^.\n]{0,40}(?:creator|author|document\s+metadata)[^.\n]{0,40}(?:to|as|=)[^.\n]{0,20}office\s*cli/is.test(message);
  const explicitCredit = creditNoun.test(message) || writeExactStamp || preservation || metadataAssignment;
  if (!explicitCredit || (!exactStamp.test(message) && !creditNoun.test(message) && !preservation && !metadataAssignment)) return 'forbid';

  const metadata = /(?:元数据|文档属性|自定义属性|创建者|作者字段|creator|author|lastmodifiedby|application\s+(?:property|metadata)|custom\s+propert|document\s+metadata)/i.test(message);
  const visible = /(?:正文|封面|页眉|页脚|文档中|报告中|body|cover|header|footer|visible)/i.test(message) || !metadata;
  return visible && metadata ? 'allow-all' : metadata ? 'allow-metadata' : 'allow-visible';
}

export function isOfficecliAttributionExplicitlyRequested(message: string): boolean {
  return getOfficecliAttributionPolicy(message) !== 'forbid';
}

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

const DOCX_PATH_RE = /\.(docx|docm)$/i;
const OFFICECLI_FLAG_RE = /^-/;
const OFFICECLI_VERB_RE =
  /^(create|add|set|open|refresh|save|close|view|get|query|validate|help|load_skill|dump|remove|batch)$/i;

export const OFFICECLI_ENSURE_DOCX_STYLES_JSON = 'officecli-ensure-docx-styles.json';

/** Built-in paragraph styles Word TOC (`TOC \\o "1-3"`) needs in styles.xml. */
export const DOCX_OUTLINE_HEADING_SPECS = [
  { id: 'Heading1', outlineLvl: 0, size: '18pt', bold: true },
  { id: 'Heading2', outlineLvl: 1, size: '14pt', bold: true },
  { id: 'Heading3', outlineLvl: 2, size: '12pt', bold: true },
  { id: 'Title', size: '24pt', bold: true },
  { id: 'TOCHeading', size: '16pt', bold: true },
] as const;

export function isOfficeDocxPath(value: string): boolean {
  return DOCX_PATH_RE.test(value);
}

export function findDocxArgInOfficecliArgs(args: string[]): string | undefined {
  return args.find(arg => !OFFICECLI_FLAG_RE.test(arg) && isOfficeDocxPath(arg));
}

function firstOfficecliVerb(args: string[]): string | undefined {
  return args.find(arg => !OFFICECLI_FLAG_RE.test(arg) && OFFICECLI_VERB_RE.test(arg))?.toLowerCase();
}

export interface DocxOutlineEnsureTiming {
  before: boolean;
  after: boolean;
}

/**
 * When the PATH wrapper should seed or repair Heading outlineLvl.
 * create / style-id writes: after (re-add wipes outlineLvl).
 * paragraph Heading / TOC writes: before (style must exist).
 * open / refresh / view: never — those must not mutate the file.
 */
export function docxOutlineEnsureTiming(args: string[]): DocxOutlineEnsureTiming {
  const none = { before: false, after: false };
  if (!findDocxArgInOfficecliArgs(args)) return none;
  const verb = firstOfficecliVerb(args);
  if (verb === 'create') return { before: false, after: true };
  if (verb !== 'add' && verb !== 'set') return none;

  let before = false;
  let after = false;
  let prev = '';
  for (const arg of args) {
    if (
      /style=Heading/i.test(arg) ||
      /style=Title/i.test(arg) ||
      /style=TOCHeading/i.test(arg) ||
      /(?:^|[=\s])toc$/i.test(arg)
    ) {
      before = true;
    }
    if (/id=Heading/i.test(arg) || /id=Title/i.test(arg) || /id=TOCHeading/i.test(arg)) {
      after = true;
    }
    if (prev === '--type' && /^toc$/i.test(arg)) before = true;
    prev = arg;
  }
  return { before, after };
}

export function shouldEnsureDocxOutlineStyles(args: string[]): boolean {
  const timing = docxOutlineEnsureTiming(args);
  return timing.before || timing.after;
}

function listingHasStyleId(listing: string, id: string): boolean {
  return new RegExp(`styleId=${id}\\b`).test(listing);
}

/** `get /styles --depth 2` lists each style, then its pPr outlineLvl on a nearby line. */
export function styleListingHasOutlineLvl(listing: string, id: string, level: number): boolean {
  const lines = listing.split(/\r?\n/);
  const index = lines.findIndex(line => new RegExp(`styleId=${id}\\b`).test(line));
  if (index < 0) return false;
  return lines.slice(index, index + 4).some(line => line.includes(`outlineLvl=${level}`));
}

export function docxStylesListingHasOutlineHeadings(listing: string): boolean {
  return (
    styleListingHasOutlineLvl(listing, 'Heading1', 0) &&
    styleListingHasOutlineLvl(listing, 'Heading2', 1) &&
    styleListingHasOutlineLvl(listing, 'Heading3', 2)
  );
}

function runOfficecli(binary: string, args: string[]): { exitCode: number; output: string } {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    env: { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: '1' },
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function headingStyleArgs(file: string, spec: (typeof DOCX_OUTLINE_HEADING_SPECS)[number]): string[] {
  const args = [
    'add',
    file,
    '/styles',
    '--type',
    'style',
    '--prop',
    `id=${spec.id}`,
    '--prop',
    'type=paragraph',
    '--prop',
    `name=${spec.id}`,
  ];
  if ('outlineLvl' in spec && spec.outlineLvl !== undefined) {
    args.push('--prop', `outlineLvl=${spec.outlineLvl}`);
  }
  if ('size' in spec && spec.size) args.push('--prop', `size=${spec.size}`);
  if ('bold' in spec && spec.bold) args.push('--prop', 'bold=true');
  return args;
}

function getEnsureStylesBatchPath(options?: ResolveOfficecliOptions): string | undefined {
  const dir = getOfficecliWrapperDir(options);
  if (!dir) return undefined;
  const json = join(dir, OFFICECLI_ENSURE_DOCX_STYLES_JSON);
  return isFile(json) ? json : undefined;
}

/**
 * Word TOC uses outlineLvl from styles.xml, not pStyle names. officecli create
 * only writes Normal. Re-adding Heading drops outlineLvl — add only when missing.
 */
export function ensureDocxOutlineHeadingStyles(
  file: string,
  options?: ResolveOfficecliOptions & { binary?: string },
): boolean {
  if (!existsSync(file) || !isOfficeDocxPath(file)) return false;
  const binary = options?.binary ?? resolveOfficecliBinary(options);
  if (!binary) return false;

  const readListing = () => runOfficecli(binary, ['get', file, '/styles', '--depth', '2']).output;
  const listing = readListing();
  if (docxStylesListingHasOutlineHeadings(listing)) return true;

  if (!listingHasStyleId(listing, 'Heading1')) {
    const batch = getEnsureStylesBatchPath(options);
    if (batch) {
      runOfficecli(binary, ['batch', file, '--best-effort', '--input', batch]);
    } else {
      for (const spec of DOCX_OUTLINE_HEADING_SPECS) {
        runOfficecli(binary, headingStyleArgs(file, spec));
      }
    }
    return docxStylesListingHasOutlineHeadings(readListing());
  }

  for (const spec of DOCX_OUTLINE_HEADING_SPECS) {
    if (!listingHasStyleId(listing, spec.id)) {
      runOfficecli(binary, headingStyleArgs(file, spec));
    } else if (
      'outlineLvl' in spec &&
      spec.outlineLvl !== undefined &&
      !styleListingHasOutlineLvl(listing, spec.id, spec.outlineLvl)
    ) {
      runOfficecli(binary, ['set', file, `/styles/${spec.id}`, '--prop', `outlineLvl=${spec.outlineLvl}`]);
    }
  }
  return docxStylesListingHasOutlineHeadings(readListing());
}

/** Directory that contains the PATH `officecli` / `officecli.cmd` wrappers. */
export function getOfficecliWrapperDir(options: ResolveOfficecliOptions = {}): string | undefined {
  const cwd = resolve(options.cwd ?? process.cwd());
  const trustedRoots = [options.resourcesPath, options.appRootPath]
    .filter((value): value is string => !!value)
    .map(root => resolve(root));
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
      const wrapper = process.platform === 'win32' ? join(dir, 'officecli.cmd') : join(dir, 'officecli');
      return trustedRoots.length > 0 ? isFileWithin(wrapper, trustedRoots) : isFile(wrapper);
    },
  );
}
