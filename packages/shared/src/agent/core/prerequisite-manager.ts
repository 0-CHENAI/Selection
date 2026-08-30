/**
 * PrerequisiteManager - Prerequisite Reading System
 *
 * Blocks tool calls until specified files have been read in the current context window.
 * State resets on compaction since the LLM loses the guide content.
 *
 * Key responsibilities:
 * - Track which files have been read via the Read tool
 * - Check prerequisites before tool execution (e.g., guide.md for sources)
 * - Reset state on context compaction
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { expandPath } from './path-processor.ts';
import { getBrowserToolEnabled } from '../../config/storage.ts';
import { catalogPathKey } from '../../skills/catalog.ts';
import { getSourceSlugForTool, hasMeaningfulSourceGuide } from '../../sources/guide-content.ts';

interface CatalogSkillRef {
  slug: string;
  skillMdPath: string;
  requiredSources?: string[];
}

// ============================================================
// Types
// ============================================================

export interface PrerequisiteRule {
  /** Match tool names that require prerequisites */
  toolMatcher: (toolName: string) => boolean;
  /** Resolve the required file path for a matched tool. Returns null to skip. */
  resolveRequiredPath: (toolName: string, workspaceRootPath: string) => string | null;
  /** Block message template. {filePath} is replaced with the required path. */
  blockMessage: string;
  /** If true, always block until file is read (no graceful fallback). */
  strict?: boolean;
}

export interface PrerequisiteCheckResult {
  allowed: boolean;
  blockReason?: string;
  sourceGuide?: SourceGuideRequirement;
}

export interface SourceGuideRequirement {
  sourceSlug: string;
  filePath: string;
  content: string;
  version: string;
  /** Sibling calls from the same assistant message must also wait for replanning. */
  alreadyPreparedInGeneration: boolean;
}

export interface PrerequisiteManagerConfig {
  workspaceRootPath: string;
  onDebug?: (message: string) => void;
}

// ============================================================
// Constants
// ============================================================

/** Global browser tools docs path required before browser tool usage. */
import { CONFIG_DIR } from '../../config/paths.ts';
const BROWSER_TOOLS_DOC_PATH = resolve(join(CONFIG_DIR, 'docs', 'browser-tools.md'));

// ============================================================
// Rules
// ============================================================

/**
 * Static prerequisite rules. Each rule defines:
 * - Which tools it applies to
 * - What file must be read first
 * - What message to show when blocking
 */
const RULES: PrerequisiteRule[] = [
  // Built-in browser tool: require browser-tools.md first.
  // Only matches the session-scoped tool (not external MCP browser tools like mcp__playwright__*),
  // and skipped entirely when the built-in browser tool is disabled.
  {
    toolMatcher: (toolName: string) =>
      (toolName === 'browser_tool' || toolName === 'mcp__session__browser_tool') &&
      getBrowserToolEnabled(),
    resolveRequiredPath: () => {
      return existsSync(BROWSER_TOOLS_DOC_PATH) ? BROWSER_TOOLS_DOC_PATH : null;
    },
    blockMessage:
      'You must read the browser tools guide before using browser automation. Please read the file at {filePath} first, then retry.',
    strict: true,
  },
];

// ============================================================
// PrerequisiteManager
// ============================================================

export class PrerequisiteManager {
  /** Max times to block a tool for the same prerequisite before allowing through */
  private static readonly MAX_REJECTIONS = 1;

  private readFiles: Set<string> = new Set();
  private rejectionCounts: Map<string, number> = new Map();
  private pendingSkillPaths: Set<string> = new Set();
  private preparedSourceGuides = new Map<string, { version: string; assistantGeneration?: number }>();
  private catalogByPath = new Map<string, CatalogSkillRef>();
  private workspaceRootPath: string;
  private onDebug?: (message: string) => void;

  constructor(config: PrerequisiteManagerConfig) {
    this.workspaceRootPath = config.workspaceRootPath;
    this.onDebug = config.onDebug;
  }

  /** Workspace changes must never reuse another workspace's guide or Skill state. */
  setWorkspaceRootPath(workspaceRootPath: string): void {
    if (resolve(workspaceRootPath) === resolve(this.workspaceRootPath)) return;

    this.workspaceRootPath = workspaceRootPath;
    this.catalogByPath.clear();
    this.resetReadState();
    this.onDebug?.(`Prerequisite: switched workspace root to ${workspaceRootPath}`);
  }

  /**
   * Register skill SKILL.md paths as prerequisites.
   * All tool calls (except Read targeting these paths) are blocked
   * until the files have been read.
   */
  registerSkillPrerequisites(paths: string[]): void {
    for (const path of paths) {
      const expanded = expandPath(path);
      this.pendingSkillPaths.add(expanded);
      this.onDebug?.(`Prerequisite: registered skill prerequisite ${expanded}`);
    }
  }

  /**
   * Remember catalog SKILL.md paths for this turn so a model-initiated Read
   * can activate that skill's requiredSources.
   */
  setCatalogSkills(entries: CatalogSkillRef[]): void {
    this.catalogByPath.clear();
    for (const entry of entries) {
      this.catalogByPath.set(catalogPathKey(entry.skillMdPath), entry);
    }
  }

  /**
   * If Read/cat targets a catalog SKILL.md, return that entry.
   * Only handbook paths count — arbitrary file Reads do not open sources.
   */
  findCatalogSkillForTool(toolName: string, input: Record<string, unknown>): CatalogSkillRef | null {
    for (const candidate of extractSkillReadCandidates(toolName, input)) {
      const hit = this.catalogByPath.get(catalogPathKey(candidate));
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Check if a tool call's prerequisites are met.
   * Source guides are prepared internally on demand. Skill/browser prerequisites
   * retain their existing model-driven read behavior.
   */
  checkPrerequisites(toolName: string, assistantGeneration?: number): PrerequisiteCheckResult {
    // Check dynamic skill prerequisites first
    const skillResult = this.checkSkillPrerequisites(toolName);
    if (!skillResult.allowed) return skillResult;

    const sourceSlug = getSourceSlugForTool(toolName);
    if (sourceSlug) {
      return this.checkSourceGuidePrerequisite(sourceSlug, assistantGeneration);
    }

    for (const rule of RULES) {
      if (!rule.toolMatcher(toolName)) continue;

      const requiredPath = rule.resolveRequiredPath(toolName, this.workspaceRootPath);
      if (!requiredPath) continue; // No guide.md exists, skip

      if (!this.readFiles.has(requiredPath)) {
        const count = (this.rejectionCounts.get(requiredPath) ?? 0) + 1;
        this.rejectionCounts.set(requiredPath, count);

        const blockReason = rule.blockMessage.replace('{filePath}', requiredPath);

        if (rule.strict) {
          this.onDebug?.(`Prerequisite blocked (strict): ${toolName} requires ${requiredPath}`);
          return { allowed: false, blockReason };
        }

        if (count <= PrerequisiteManager.MAX_REJECTIONS) {
          this.onDebug?.(`Prerequisite blocked (${count}/${PrerequisiteManager.MAX_REJECTIONS}): ${toolName} requires ${requiredPath}`);
          return { allowed: false, blockReason };
        }
        // Exceeded max rejections — allow through gracefully
        this.onDebug?.(`Prerequisite: allowing ${toolName} after ${count} rejections (max reached)`);
      }
    }

    return { allowed: true };
  }

  private checkSourceGuidePrerequisite(
    sourceSlug: string,
    assistantGeneration?: number,
  ): PrerequisiteCheckResult {
    const filePath = resolve(this.workspaceRootPath, 'sources', sourceSlug, 'guide.md');
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (error) {
      this.preparedSourceGuides.delete(sourceSlug);
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { allowed: true };
      }
      const detail = error instanceof Error ? error.message : String(error);
      return {
        allowed: false,
        blockReason: `Source "${sourceSlug}" has a guide that cannot be read at ${filePath}: ${detail}`,
      };
    }

    if (!hasMeaningfulSourceGuide(content)) {
      this.preparedSourceGuides.delete(sourceSlug);
      return { allowed: true };
    }

    const version = createHash('sha256').update(content).digest('hex');
    const prepared = this.preparedSourceGuides.get(sourceSlug);
    const alreadyPrepared = prepared?.version === version;
    const sameGeneration = alreadyPrepared
      && assistantGeneration !== undefined
      && prepared.assistantGeneration === assistantGeneration;

    if (alreadyPrepared && !sameGeneration) {
      return { allowed: true };
    }

    if (prepared && !alreadyPrepared) {
      this.preparedSourceGuides.delete(sourceSlug);
    }

    this.onDebug?.(
      sameGeneration
        ? `Source guide preparation: deferring sibling call for ${sourceSlug}`
        : `Source guide preparation required: ${sourceSlug} (${filePath})`,
    );

    return {
      allowed: false,
      sourceGuide: {
        sourceSlug,
        filePath,
        content,
        version,
        alreadyPreparedInGeneration: sameGeneration,
      },
    };
  }

  /** Mark a source guide ready only after its content was returned to model history. */
  markSourceGuidePrepared(
    requirement: Pick<SourceGuideRequirement, 'sourceSlug' | 'filePath' | 'version'>,
    assistantGeneration?: number,
  ): void {
    this.preparedSourceGuides.set(requirement.sourceSlug, {
      version: requirement.version,
      assistantGeneration,
    });
    this.readFiles.add(expandPath(requirement.filePath));
    this.onDebug?.(`Source guide prepared: ${requirement.sourceSlug}`);
  }

  /** A user/model-directed Read counts only after its successful tool result. */
  trackSuccessfulSourceGuideRead(toolInput: Record<string, unknown>): void {
    const filePath = typeof toolInput.file_path === 'string'
      ? toolInput.file_path
      : typeof toolInput.path === 'string'
        ? toolInput.path
        : null;
    if (!filePath) return;

    const expanded = resolve(expandPath(filePath));
    const fromSources = relative(resolve(this.workspaceRootPath, 'sources'), expanded);
    const parts = fromSources.split(sep);
    if (parts.length !== 2 || parts[1] !== 'guide.md' || !parts[0] || parts[0] === '..') return;

    const inspection = this.checkSourceGuidePrerequisite(parts[0]);
    if (inspection.sourceGuide) {
      this.markSourceGuidePrepared(inspection.sourceGuide);
    }
  }

  /**
   * Check dynamic skill prerequisites.
   * If pending skill paths exist and the tool is NOT a Read targeting one of them, block.
   */
  private checkSkillPrerequisites(toolName: string): PrerequisiteCheckResult {
    if (this.pendingSkillPaths.size === 0) return { allowed: true };

    // Allow Read tool through — trackReadTool will clear the prerequisite
    if (toolName === 'Read') return { allowed: true };

    const pendingList = [...this.pendingSkillPaths].join(', ');
    const key = `skill:${pendingList}`;
    const count = (this.rejectionCounts.get(key) ?? 0) + 1;
    this.rejectionCounts.set(key, count);

    if (count <= PrerequisiteManager.MAX_REJECTIONS) {
      const blockReason = `You must read the skill instruction files before proceeding. Use Read or \`cat\` via Bash to read: ${pendingList}`;
      this.onDebug?.(`Skill prerequisite blocked (${count}/${PrerequisiteManager.MAX_REJECTIONS}): ${toolName} — pending: ${pendingList}`);
      return { allowed: false, blockReason };
    }

    // Exceeded max rejections — allow through and clear
    this.onDebug?.(`Skill prerequisite: allowing ${toolName} after ${count} rejections (max reached)`);
    this.pendingSkillPaths.clear();
    return { allowed: true };
  }

  /**
   * Track a Read tool call. Extracts file_path from tool input,
   * normalizes it, and adds to the read set.
   * Also clears matching pending skill paths.
   */
  trackReadTool(toolInput: Record<string, unknown>): void {
    const filePath = (toolInput.file_path as string) || (toolInput.path as string);
    if (!filePath) return;

    const expanded = expandPath(filePath);
    this.readFiles.add(expanded);

    // Clear matching pending skill path
    if (this.pendingSkillPaths.has(expanded)) {
      this.pendingSkillPaths.delete(expanded);
      this.onDebug?.(`Prerequisite: cleared skill prerequisite ${expanded}`);
    }

    this.onDebug?.(`Prerequisite: tracked read of ${expanded}`);
  }

  /**
   * Check if a Bash command is reading a pending skill file.
   * If it matches, clear the prerequisite and return true.
   * Called from the pre-tool-use pipeline to allow targeted Bash reads through.
   */
  trackBashSkillRead(input: Record<string, unknown>): boolean {
    const command = input.command as string;
    if (!command || this.pendingSkillPaths.size === 0) return false;

    let matched = false;
    for (const path of this.pendingSkillPaths) {
      if (command.includes(path)) {
        this.pendingSkillPaths.delete(path);
        this.readFiles.add(path);
        this.onDebug?.(`Prerequisite: cleared skill prerequisite via Bash: ${path}`);
        matched = true;
      }
    }
    return matched;
  }

  /**
   * Reset read state. Called on context compaction since the LLM
   * loses the guide content and needs to re-read.
   * Also clears pending skill paths (model lost the directive).
   */
  resetReadState(): void {
    const count = this.readFiles.size;
    const skillCount = this.pendingSkillPaths.size;
    this.readFiles.clear();
    this.rejectionCounts.clear();
    this.pendingSkillPaths.clear();
    this.preparedSourceGuides.clear();
    this.onDebug?.(`Prerequisite: reset read state (cleared ${count} reads, ${skillCount} skill prerequisites)`);
  }

  /**
   * Check if a specific file has been read (for testing).
   */
  hasRead(filePath: string): boolean {
    return this.readFiles.has(expandPath(filePath));
  }
}

const SKILL_MD_IN_COMMAND_RE = /(?:^|[\s"'`])((?:~|\/|[A-Za-z]:[\\/])[^\s"'`;|&]+SKILL\.md)/gi;

export function extractSkillMdPathsFromCommand(command: string): string[] {
  const paths: string[] = [];
  const matcher = new RegExp(SKILL_MD_IN_COMMAND_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(command))) {
    paths.push(match[1]!);
  }
  return paths;
}

export function extractSkillReadCandidates(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === 'Read') {
    const filePath = (typeof input.file_path === 'string' && input.file_path)
      || (typeof input.path === 'string' && input.path)
      || '';
    return filePath ? [filePath] : [];
  }
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return extractSkillMdPathsFromCommand(input.command);
  }
  return [];
}
