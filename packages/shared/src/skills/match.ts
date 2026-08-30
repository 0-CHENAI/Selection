/**
 * Soft skill matching for the current turn.
 *
 * Globs / attachments suggest a skill and can pre-enable requiredSources.
 * They do not force a SKILL.md Read. Office files still hard-load officecli
 * elsewhere and must not emit a duplicate suggestion for that slug.
 */

import { basename } from 'node:path';
import { shouldLoadBundledOfficecliRouter } from '../utils/officecli.ts';
import { defangAvailableSkillsTag, isExcludedFromSkillCatalog, toSkillCatalogEntries, type SkillCatalogEntry } from './catalog.ts';
import type { LoadedSkill } from './types.ts';

export interface SkillMatchAttachment {
  type?: string;
  name?: string;
  path?: string;
  storedPath?: string;
  mimeType?: string;
}

export interface SkillMatchInput {
  message: string;
  attachments?: SkillMatchAttachment[];
}

export interface SkillMatch {
  slug: string;
  title: string;
  skillMdPath: string;
  requiredSources?: string[];
  reason: 'glob' | 'attachment';
}

const PATH_LIKE_RE = new RegExp(
  String.raw`(?:[A-Za-z]:)?(?:/|\\)?(?:[^\s\\/:*?"<>|]+[/\\])+[^\s\\/:*?"<>|]+\.[A-Za-z][A-Za-z0-9]{1,7}\b|[^\s\\/:*?"<>|]+\.[A-Za-z][A-Za-z0-9]{1,7}\b`,
  'g',
);

const MIME_TO_EXT: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/svg+xml': ['svg'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'image/bmp': ['bmp'],
  'image/tiff': ['tiff', 'tif'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
  'video/x-matroska': ['mkv'],
};

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

/** Convert a skill glob (`**` + `/` + `*.pdf`, or brace alternatives) to a case-insensitive matcher. */
export function globToRegExp(glob: string): RegExp {
  let i = 0;
  let out = '^';
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (glob.startsWith('**', i)) {
      out += '.*';
      i += 2;
      continue;
    }
    const char = glob[i]!;
    if (char === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (char === '{') {
      const end = glob.indexOf('}', i);
      if (end !== -1) {
        const alts = glob.slice(i + 1, end).split(',').map(part => escapeRegex(part.trim())).join('|');
        out += `(?:${alts})`;
        i = end + 1;
        continue;
      }
    }
    out += escapeRegex(char);
    i += 1;
  }
  out += '$';
  return new RegExp(out, 'i');
}

function normalizeMatchPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function extractPathLikeTokens(message: string): string[] {
  const matcher = new RegExp(PATH_LIKE_RE.source, 'g');
  return message.match(matcher) ?? [];
}

function mimeExtensions(mimeType: string | undefined): string[] {
  if (!mimeType) return [];
  const exact = MIME_TO_EXT[mimeType.toLowerCase()];
  if (exact) return exact;
  if (mimeType.startsWith('image/')) return ['png'];
  if (mimeType.startsWith('video/')) return ['mp4'];
  if (mimeType.toLowerCase().includes('pdf')) return ['pdf'];
  return [];
}

function attachmentCandidates(attachment: SkillMatchAttachment): string[] {
  const names = [attachment.name, attachment.path, attachment.storedPath]
    .filter((value): value is string => !!value);
  const exts = mimeExtensions(attachment.mimeType);
  if (attachment.type === 'image' && exts.length === 0) exts.push('png');
  if (attachment.type === 'pdf' && exts.length === 0) exts.push('pdf');
  if (attachment.type === 'unknown' && /video\//i.test(attachment.mimeType ?? '')) {
    exts.push('mp4');
  }
  for (const ext of exts) {
    names.push(`attachment.${ext}`);
  }
  return names;
}

function collectMatchCandidates(input: SkillMatchInput): { paths: string[]; fromAttachment: boolean } {
  const paths = extractPathLikeTokens(input.message).map(normalizeMatchPath);
  let fromAttachment = false;
  for (const attachment of input.attachments ?? []) {
    const extras = attachmentCandidates(attachment).map(normalizeMatchPath);
    if (extras.length > 0) fromAttachment = true;
    paths.push(...extras);
  }
  return { paths, fromAttachment };
}

function globMatches(glob: string, candidate: string): boolean {
  const matcher = globToRegExp(glob);
  const normalized = normalizeMatchPath(candidate);
  if (matcher.test(normalized)) return true;
  const fileName = basename(normalized);
  return matcher.test(fileName) || matcher.test(`/${fileName}`);
}

function skillMatchesGlobs(globs: string[] | undefined, candidates: string[]): boolean {
  if (!globs?.length) return false;
  return globs.some(glob => candidates.some(candidate => globMatches(glob, candidate)));
}

function toMatch(entry: SkillCatalogEntry, reason: SkillMatch['reason']): SkillMatch {
  return {
    slug: entry.slug,
    title: entry.title,
    skillMdPath: entry.skillMdPath,
    requiredSources: entry.requiredSources,
    reason,
  };
}

function isLoadedSkill(value: LoadedSkill | SkillCatalogEntry): value is LoadedSkill {
  return 'metadata' in value && 'content' in value && 'path' in value;
}

function toMatchEntries(skills: LoadedSkill[] | SkillCatalogEntry[]): SkillCatalogEntry[] {
  if (skills.length === 0) return [];
  return isLoadedSkill(skills[0]!)
    ? toSkillCatalogEntries(skills as LoadedSkill[])
    : (skills as SkillCatalogEntry[]).filter(entry => !isExcludedFromSkillCatalog(entry.slug));
}

export function matchSkillsByGlobs(
  skills: LoadedSkill[] | SkillCatalogEntry[],
  input: SkillMatchInput,
): SkillMatch[] {
  const entries = toMatchEntries(skills);

  const { paths, fromAttachment } = collectMatchCandidates(input);
  if (paths.length === 0) return [];

  const matches: SkillMatch[] = [];
  for (const entry of entries) {
    if (!skillMatchesGlobs(entry.globs, paths)) continue;
    matches.push(toMatch(entry, fromAttachment ? 'attachment' : 'glob'));
  }
  return matches;
}

export function formatSkillSuggestions(
  matches: SkillMatch[],
  excludeSlugs: Iterable<string> = [],
): string | null {
  const excluded = new Set(excludeSlugs);
  const remaining = matches.filter(match => !excluded.has(match.slug));
  if (remaining.length === 0) return null;

  const lines = remaining.map(match => {
    const title = defangAvailableSkillsTag(match.title.replace(/\s+/g, ' ').trim());
    const slug = defangAvailableSkillsTag(match.slug.replace(/\s+/g, ' ').trim());
    return `- ${title} (${slug})\n  path: ${match.skillMdPath}`;
  });
  return [
    'The following skills may apply this turn. Read the listed SKILL.md if relevant; other tools are not blocked until you do:',
    ...lines,
  ].join('\n');
}

/**
 * Mentions, Office-file hard-load, and glob/attachment hits.
 * Soft-suggest exclusion of officecli lives in the chat path, not here —
 * hard-load still pre-enables that skill's requiredSources.
 */
export function collectSkillSlugsForSourcePreEnable(options: {
  message: string;
  attachments?: SkillMatchAttachment[];
  mentionedSlugs?: string[];
  skills: LoadedSkill[];
}): string[] {
  const slugs = new Set(options.mentionedSlugs ?? []);
  if (shouldLoadBundledOfficecliRouter(options.message, options.attachments)) {
    slugs.add('officecli');
  }
  for (const match of matchSkillsByGlobs(options.skills, {
    message: options.message,
    attachments: options.attachments,
  })) {
    slugs.add(match.slug);
  }
  return [...slugs];
}
