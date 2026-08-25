/**
 * Skills Module
 *
 * Workspace skills are specialized instructions that extend Claude's capabilities.
 */

export * from './types.ts';
export {
  GLOBAL_AGENT_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
  getBundledSkillsDir,
  getBundledSkillDirectories,
  isUserFacingSkill,
  filterUserFacingSkills,
  resolveBundledSkillMdPath,
  loadSkill,
  loadAllSkills,
  invalidateSkillsCache,
  loadSkillBySlug,
  getSkillIconPath,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
} from './storage.ts';
export {
  AVAILABLE_SKILLS_TAG,
  OFFICECLI_CATALOG_TRIGGER,
  SKILL_CATALOG_MAX_DESCRIPTION_LENGTH,
  buildSkillCatalog,
  catalogPathKey,
  defangAvailableSkillsTag,
  findCatalogEntryBySkillMdPath,
  formatSkillCatalog,
  isExcludedFromSkillCatalog,
  toSkillCatalogEntries,
  truncateSkillDescription,
  type SkillCatalogEntry,
} from './catalog.ts';
export {
  collectSkillSlugsForSourcePreEnable,
  extractPathLikeTokens,
  formatSkillSuggestions,
  globToRegExp,
  matchSkillsByGlobs,
  type SkillMatch,
  type SkillMatchAttachment,
  type SkillMatchInput,
} from './match.ts';
