/**
 * Skill capability catalog for the agent prompt.
 *
 * Hermes-style handbook: slug + title + full description + SKILL.md path stay
 * in context every turn. The model Reads a skill on demand; format/OfficeCLI
 * guides stay off this list and load only through the officecli router.
 */

import { join, resolve } from 'node:path';
import { BUNDLED_OFFICECLI_SKILL_SLUGS } from '../utils/officecli.ts';
import { expandPath } from '../utils/paths.ts';
import { resolveBundledSkillMdPath } from './storage.ts';
import type { LoadedSkill } from './types.ts';

export const SKILL_CATALOG_MAX_DESCRIPTION_LENGTH = 1024;
export const AVAILABLE_SKILLS_TAG = 'available_skills';

/** Catalog trigger for the bundled OfficeCLI router. */
export const OFFICECLI_CATALOG_TRIGGER =
  'Read this skill first for any Word, Excel, or PowerPoint create, inspect, or edit, then run `officecli load_skill`.';

const EXCLUDED_CATALOG_SLUGS = new Set<string>([
  ...BUNDLED_OFFICECLI_SKILL_SLUGS,
  'docx',
  'xlsx',
  'pptx',
]);

export interface SkillCatalogEntry {
  slug: string;
  title: string;
  description: string;
  skillMdPath: string;
  requiredSources?: string[];
  globs?: string[];
}

export function isExcludedFromSkillCatalog(slug: string): boolean {
  if (slug === 'officecli') return false;
  return EXCLUDED_CATALOG_SLUGS.has(slug) || slug.startsWith('officecli-');
}

export function catalogPathKey(filePath: string): string {
  return resolve(expandPath(filePath)).replace(/\\/g, '/').toLowerCase();
}

export function findCatalogEntryBySkillMdPath(
  entries: SkillCatalogEntry[],
  filePath: string,
): SkillCatalogEntry | undefined {
  const key = catalogPathKey(filePath);
  return entries.find(entry => catalogPathKey(entry.skillMdPath) === key);
}

export function truncateSkillDescription(description: string): string {
  if (description.length <= SKILL_CATALOG_MAX_DESCRIPTION_LENGTH) return description;
  return `${description.slice(0, SKILL_CATALOG_MAX_DESCRIPTION_LENGTH)}...`;
}

/** Neutralize a literal closing catalog tag so injected text cannot close the block. */
export function defangAvailableSkillsTag(text: string): string {
  return text.replace(/<\s*\/\s*available_skills\s*>/gi, '&lt;/available_skills&gt;');
}

function normalizeCatalogText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function ensureOfficecliTrigger(description: string): string {
  if (/officecli load_skill/i.test(description)) return description;
  return `${description} ${OFFICECLI_CATALOG_TRIGGER}`.trim();
}

function toEntry(skill: LoadedSkill, skillMdPath: string, description: string): SkillCatalogEntry {
  return {
    slug: skill.slug,
    title: normalizeCatalogText(skill.displayTitle ?? skill.metadata.name),
    description: truncateSkillDescription(normalizeCatalogText(description)),
    skillMdPath,
    requiredSources: skill.metadata.requiredSources,
    globs: skill.metadata.globs,
  };
}

export function toSkillCatalogEntries(skills: LoadedSkill[]): SkillCatalogEntry[] {
  const bundledOfficecliPath = resolveBundledSkillMdPath('officecli');
  const entries: SkillCatalogEntry[] = [];
  let sawOfficecli = false;

  for (const skill of skills) {
    if (isExcludedFromSkillCatalog(skill.slug)) continue;

    if (skill.slug === 'officecli') {
      sawOfficecli = true;
      entries.push(toEntry(
        skill,
        bundledOfficecliPath ?? join(skill.path, 'SKILL.md'),
        ensureOfficecliTrigger(skill.metadata.description ?? ''),
      ));
      continue;
    }

    entries.push(toEntry(skill, join(skill.path, 'SKILL.md'), skill.metadata.description ?? ''));
  }

  if (!sawOfficecli && bundledOfficecliPath) {
    entries.push({
      slug: 'officecli',
      title: 'officecli',
      description: OFFICECLI_CATALOG_TRIGGER,
      skillMdPath: bundledOfficecliPath,
    });
  }

  return entries.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function formatSkillCatalog(entries: SkillCatalogEntry[]): string | null {
  if (entries.length === 0) return null;

  const lines = entries.map(entry => {
    const title = defangAvailableSkillsTag(entry.title);
    const slug = defangAvailableSkillsTag(entry.slug);
    const description = defangAvailableSkillsTag(entry.description);
    const skillMdPath = defangAvailableSkillsTag(entry.skillMdPath);
    const needs = entry.requiredSources?.length
      ? `\n  needs: ${defangAvailableSkillsTag(normalizeCatalogText(entry.requiredSources.join(', ')))}`
      : '';
    return `- ${title} (${slug}): ${description}\n  path: ${skillMdPath}${needs}`;
  });

  return `<${AVAILABLE_SKILLS_TAG}>\n${lines.join('\n')}\n</${AVAILABLE_SKILLS_TAG}>`;
}

export function buildSkillCatalog(skills: LoadedSkill[]): string | null {
  return formatSkillCatalog(toSkillCatalogEntries(skills));
}
