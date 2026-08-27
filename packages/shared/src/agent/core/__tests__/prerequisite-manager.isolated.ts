/**
 * Tests for PrerequisiteManager
 *
 * Tests the prerequisite reading system that blocks tool calls
 * until required files (like guide.md) have been read.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { PrerequisiteManager } from '../prerequisite-manager.ts';

let mockExistsPaths: Set<string> = new Set();
let mockGuideContents: Map<string, string> = new Map();
let mockGuideReadFailures: Set<string> = new Set();

mock.module('node:fs', () => ({
  existsSync: (path: string) => mockExistsPaths.has(path),
  readFileSync: (path: string) => {
    if (mockGuideReadFailures.has(path)) throw new Error('permission denied');
    if (!mockExistsPaths.has(path)) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
        code: 'ENOENT',
      });
    }
    return mockGuideContents.get(path) ?? '# Source\nUse the documented endpoint.';
  },
}));

mock.module('../../../config/storage.ts', () => ({
  getBrowserToolEnabled: () => true,
}));

const WORKSPACE_ROOT = '/test/workspace';

function guidePath(slug: string): string {
  return resolve(WORKSPACE_ROOT, 'sources', slug, 'guide.md');
}

function browserDocPath(): string {
  return resolve(join(homedir(), '.selection', 'docs', 'browser-tools.md'));
}

describe('PrerequisiteManager', () => {
  let manager: PrerequisiteManager;
  let debugMessages: string[];

  beforeEach(() => {
    debugMessages = [];
    mockExistsPaths = new Set();
    mockGuideContents = new Map();
    mockGuideReadFailures = new Set();
    manager = new PrerequisiteManager({
      workspaceRootPath: WORKSPACE_ROOT,
      onDebug: (msg) => debugMessages.push(msg),
    });
  });

  // ============================================================
  // Rule Matching
  // ============================================================

  describe('rule matching', () => {
    it('matches MCP source tools (mcp__{slug}__{tool})', () => {
      mockExistsPaths.add(guidePath('linear'));
      const result = manager.checkPrerequisites('mcp__linear__createIssue');
      expect(result.allowed).toBe(false);
      expect(result.sourceGuide?.filePath).toContain('guide.md');
    });

    it('matches API source tools (api_{slug})', () => {
      mockExistsPaths.add(guidePath('github'));
      const result = manager.checkPrerequisites('api_github');
      expect(result.allowed).toBe(false);
      expect(result.sourceGuide?.filePath).toContain('guide.md');
    });

    it('does not match built-in tools', () => {
      const result = manager.checkPrerequisites('Read');
      expect(result.allowed).toBe(true);
    });

    it('does not match Bash tool', () => {
      const result = manager.checkPrerequisites('Bash');
      expect(result.allowed).toBe(true);
    });

    it('does not match Write tool', () => {
      const result = manager.checkPrerequisites('Write');
      expect(result.allowed).toBe(true);
    });

    it('exempts session MCP tools', () => {
      mockExistsPaths.add(guidePath('session'));
      const result = manager.checkPrerequisites('mcp__session__SubmitPlan');
      expect(result.allowed).toBe(true);
    });

    it('exempts craft-agents-docs MCP tools', () => {
      mockExistsPaths.add(guidePath('craft-agents-docs'));
      const result = manager.checkPrerequisites('mcp__craft-agents-docs__search');
      expect(result.allowed).toBe(true);
    });

    it('handles malformed MCP tool names (fewer than 3 parts)', () => {
      const result = manager.checkPrerequisites('mcp__linear');
      expect(result.allowed).toBe(true);
    });

    it('matches native browser tools and blocks until browser docs are read', () => {
      const docsPath = browserDocPath();
      mockExistsPaths.add(docsPath);

      const result = manager.checkPrerequisites('browser_tool');
      expect(result.allowed).toBe(false);
      expect(result.blockReason).toContain(docsPath);
    });

    it('matches session browser tools and blocks until browser docs are read', () => {
      const docsPath = browserDocPath();
      mockExistsPaths.add(docsPath);

      const result = manager.checkPrerequisites('mcp__session__browser_tool');
      expect(result.allowed).toBe(false);
      expect(result.blockReason).toContain(docsPath);
    });
  });

  // ============================================================
  // Path Resolution
  // ============================================================

  describe('path resolution', () => {
    it('resolves guide.md path from MCP tool name', () => {
      const expected = guidePath('linear');
      mockExistsPaths.add(expected);
      const result = manager.checkPrerequisites('mcp__linear__createIssue');
      expect(result.allowed).toBe(false);
      expect(result.sourceGuide?.filePath).toBe(expected);
    });

    it('resolves guide.md path from API tool name', () => {
      const expected = guidePath('slack');
      mockExistsPaths.add(expected);
      const result = manager.checkPrerequisites('api_slack');
      expect(result.allowed).toBe(false);
      expect(result.sourceGuide?.filePath).toBe(expected);
    });
  });

  // ============================================================
  // Read Tracking
  // ============================================================

  describe('read tracking', () => {
    it('allows tool after guide.md has been read', () => {
      const guideFile = guidePath('linear');
      mockExistsPaths.add(guideFile);

      // Before reading - blocked
      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(false);

      // Starting a Read does not prove the guide reached model history.
      manager.trackReadTool({ file_path: guideFile });
      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(false);

      manager.trackSuccessfulSourceGuideRead({ file_path: guideFile });

      // After reading - allowed
      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(true);
    });

    it('tracks reads using path parameter', () => {
      const guideFile = guidePath('github');
      mockExistsPaths.add(guideFile);

      manager.trackSuccessfulSourceGuideRead({ path: guideFile });
      expect(manager.checkPrerequisites('api_github').allowed).toBe(true);
    });

    it('ignores trackReadTool with no path', () => {
      manager.trackReadTool({});
      expect(manager.hasRead('/any/path')).toBe(false);
    });

    it('tracks multiple reads independently', () => {
      const linearGuide = guidePath('linear');
      const slackGuide = guidePath('slack');
      mockExistsPaths.add(linearGuide);
      mockExistsPaths.add(slackGuide);

      manager.trackSuccessfulSourceGuideRead({ file_path: linearGuide });

      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(true);
      expect(manager.checkPrerequisites('mcp__slack__sendMessage').allowed).toBe(false);
    });
  });

  // ============================================================
  // Reset
  // ============================================================

  describe('reset', () => {
    it('clears all read state', () => {
      const guideFile = guidePath('linear');
      mockExistsPaths.add(guideFile);

      manager.trackSuccessfulSourceGuideRead({ file_path: guideFile });
      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(true);

      manager.resetReadState();
      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(false);
    });

    it('logs debug message on reset', () => {
      manager.trackReadTool({ file_path: '/some/file' });
      manager.resetReadState();
      expect(debugMessages.some((m) => m.includes('reset read state'))).toBe(true);
    });
  });

  // ============================================================
  // Guide Nonexistence
  // ============================================================

  describe('guide nonexistence', () => {
    it('allows tool when guide.md does not exist', () => {
      // Don't add to mockExistsPaths — guide.md doesn't exist
      const result = manager.checkPrerequisites('mcp__linear__createIssue');
      expect(result.allowed).toBe(true);
    });

    it('allows API tool when guide.md does not exist', () => {
      const result = manager.checkPrerequisites('api_github');
      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================
  // Path Normalization
  // ============================================================

  describe('path normalization', () => {
    it('normalizes tilde paths in trackReadTool', () => {
      const guideFile = guidePath('linear');
      mockExistsPaths.add(guideFile);

      // Track with tilde path that expands to the same absolute path
      const homeDir = process.env.HOME || process.env.USERPROFILE || '/home/user';
      const tildeRelative = `~/some-file.md`;
      manager.trackReadTool({ file_path: tildeRelative });

      // The expanded path should be tracked
      expect(manager.hasRead(tildeRelative)).toBe(true);
    });
  });

  // ============================================================
  // Source-guide preparation never bypasses meaningful instructions.
  // ============================================================

  describe('source guide preparation', () => {
    it('requires preparation on every attempt until the guide is delivered', () => {
      mockExistsPaths.add(guidePath('linear'));

      const first = manager.checkPrerequisites('mcp__linear__createIssue');
      expect(first.allowed).toBe(false);
      expect(first.sourceGuide?.sourceSlug).toBe('linear');

      const second = manager.checkPrerequisites('mcp__linear__createIssue');
      expect(second.allowed).toBe(false);
      expect(second.sourceGuide?.sourceSlug).toBe('linear');
    });

    it('tracks source-guide preparation independently', () => {
      mockExistsPaths.add(guidePath('linear'));
      mockExistsPaths.add(guidePath('slack'));

      const linear = manager.checkPrerequisites('mcp__linear__createIssue');
      expect(linear.allowed).toBe(false);

      expect(manager.checkPrerequisites('mcp__slack__sendMessage').allowed).toBe(false);

      manager.markSourceGuidePrepared(linear.sourceGuide!);
      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(true);
      expect(manager.checkPrerequisites('mcp__slack__sendMessage').allowed).toBe(false);
    });

    it('re-prepares guides after context reset', () => {
      mockExistsPaths.add(guidePath('linear'));

      const pending = manager.checkPrerequisites('mcp__linear__createIssue');
      manager.markSourceGuidePrepared(pending.sourceGuide!);
      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(true);

      manager.resetReadState();
      expect(manager.checkPrerequisites('mcp__linear__createIssue').allowed).toBe(false);
    });

    it('reuses a prepared guide across different tools from the same source', () => {
      mockExistsPaths.add(guidePath('linear'));

      const first = manager.checkPrerequisites('mcp__linear__createIssue');
      manager.markSourceGuidePrepared(first.sourceGuide!);
      expect(manager.checkPrerequisites('mcp__linear__listIssues').allowed).toBe(true);
    });

    it('skips automatically generated placeholder guides', () => {
      const filePath = guidePath('anysearch');
      mockExistsPaths.add(filePath);
      mockGuideContents.set(filePath,
        '# anysearch\n\n## Guidelines\n\n(Add usage guidelines here)\n\n## Context\n\n(Add context about this source)',
      );

      expect(manager.checkPrerequisites('mcp__anysearch__search').allowed).toBe(true);
      expect(manager.checkPrerequisites('api_anysearch').allowed).toBe(true);
    });

    it('does not execute sibling calls created before their guide entered context', () => {
      mockExistsPaths.add(guidePath('linear'));
      const first = manager.checkPrerequisites('mcp__linear__createIssue', 7);
      manager.markSourceGuidePrepared(first.sourceGuide!, 7);

      const sibling = manager.checkPrerequisites('mcp__linear__listIssues', 7);
      expect(sibling.allowed).toBe(false);
      expect(sibling.sourceGuide?.alreadyPreparedInGeneration).toBe(true);
      expect(manager.checkPrerequisites('mcp__linear__listIssues', 8).allowed).toBe(true);
    });

    it('invalidates a prepared guide when its contents change', () => {
      const filePath = guidePath('linear');
      mockExistsPaths.add(filePath);
      mockGuideContents.set(filePath, '# Source\nUse v1.');
      const first = manager.checkPrerequisites('api_linear');
      manager.markSourceGuidePrepared(first.sourceGuide!);

      mockGuideContents.set(filePath, '# Source\nUse v2.');
      const updated = manager.checkPrerequisites('api_linear');
      expect(updated.allowed).toBe(false);
      expect(updated.sourceGuide?.content).toContain('Use v2.');
      expect(updated.sourceGuide?.version).not.toBe(first.sourceGuide?.version);
    });

    it('allows a guide after its instructions are removed', () => {
      const filePath = guidePath('linear');
      mockExistsPaths.add(filePath);
      expect(manager.checkPrerequisites('api_linear').allowed).toBe(false);

      mockGuideContents.set(filePath, '# Source\n\n## Guidelines');
      expect(manager.checkPrerequisites('api_linear').allowed).toBe(true);
    });

    it('fails closed when an existing source guide cannot be read', () => {
      const filePath = guidePath('linear');
      mockExistsPaths.add(filePath);
      mockGuideReadFailures.add(filePath);

      const result = manager.checkPrerequisites('api_linear');
      expect(result.allowed).toBe(false);
      expect(result.sourceGuide).toBeUndefined();
      expect(result.blockReason).toContain('permission denied');
    });

    it('fails closed when guide access is denied even if an existence probe cannot see it', () => {
      const filePath = guidePath('linear');
      mockGuideReadFailures.add(filePath);

      const result = manager.checkPrerequisites('api_linear');
      expect(result.allowed).toBe(false);
      expect(result.blockReason).toContain('permission denied');
    });

    it('does not bypass strict browser prerequisite after repeated rejections', () => {
      const docsPath = browserDocPath();
      mockExistsPaths.add(docsPath);

      expect(manager.checkPrerequisites('browser_tool').allowed).toBe(false);
      expect(manager.checkPrerequisites('browser_tool').allowed).toBe(false);

      manager.trackReadTool({ file_path: docsPath });
      expect(manager.checkPrerequisites('browser_tool').allowed).toBe(true);
    });
  });

  // ============================================================
  // Bash Skill Read Tracking
  // ============================================================

  describe('trackBashSkillRead', () => {
    it('clears skill prerequisite when Bash command contains the skill path', () => {
      const skillPath = '/test/workspace/skills/my-skill/SKILL.md';
      manager.registerSkillPrerequisites([skillPath]);

      // WebSearch should be blocked (skill prerequisite pending)
      expect(manager.checkPrerequisites('WebSearch').allowed).toBe(false);

      // Reset rejection count so we can test the block again after clearing
      manager.resetReadState();
      manager.registerSkillPrerequisites([skillPath]);

      // Bash cat targeting the skill path should clear the prerequisite
      const result = manager.trackBashSkillRead({ command: `cat ${skillPath}` });
      expect(result).toBe(true);

      // Now other tools should be allowed
      expect(manager.checkPrerequisites('WebSearch').allowed).toBe(true);
    });

    it('returns false when Bash command does not contain a pending skill path', () => {
      const skillPath = '/test/workspace/skills/my-skill/SKILL.md';
      manager.registerSkillPrerequisites([skillPath]);

      const result = manager.trackBashSkillRead({ command: 'ls -la /some/other/path' });
      expect(result).toBe(false);
    });

    it('does not clear a skill prerequisite when a command only mentions the path', () => {
      const skillPath = '/test/workspace/skills/my-skill/SKILL.md';
      manager.registerSkillPrerequisites([skillPath]);

      expect(manager.trackBashSkillRead({ command: `echo ${skillPath}` })).toBe(false);
      expect(manager.checkPrerequisites('WebSearch').allowed).toBe(false);
    });

    it('recognizes quoted PowerShell reads without accepting unrelated commands', () => {
      const skillPath = '/test/workspace/skills/my skill/SKILL.md';
      manager.registerSkillPrerequisites([skillPath]);

      expect(manager.trackBashSkillRead({
        command: `Get-Content -Raw "${skillPath}"`,
      })).toBe(true);
      expect(manager.checkPrerequisites('WebSearch').allowed).toBe(true);
    });

    it('returns false when there are no pending skill paths', () => {
      const result = manager.trackBashSkillRead({ command: 'cat /any/file' });
      expect(result).toBe(false);
    });

    it('returns false when command is missing', () => {
      manager.registerSkillPrerequisites(['/some/skill/SKILL.md']);
      const result = manager.trackBashSkillRead({});
      expect(result).toBe(false);
    });

    it('clears multiple skill prerequisites from a single command', () => {
      const skill1 = '/test/workspace/skills/alpha/SKILL.md';
      const skill2 = '/test/workspace/skills/beta/SKILL.md';
      manager.registerSkillPrerequisites([skill1, skill2]);

      // Command that contains both paths
      const result = manager.trackBashSkillRead({
        command: `cat ${skill1} && cat ${skill2}`,
      });
      expect(result).toBe(true);

      // Both should be cleared
      expect(manager.checkPrerequisites('WebSearch').allowed).toBe(true);
    });

    it('logs debug message when clearing via Bash', () => {
      const skillPath = '/test/workspace/skills/my-skill/SKILL.md';
      manager.registerSkillPrerequisites([skillPath]);

      manager.trackBashSkillRead({ command: `cat ${skillPath}` });
      expect(debugMessages.some(m => m.includes('cleared skill prerequisite via Bash'))).toBe(true);
    });
  });

  // ============================================================
  // Debug Logging
  // ============================================================

  describe('debug logging', () => {
    it('logs when a tool is blocked', () => {
      mockExistsPaths.add(guidePath('linear'));
      manager.checkPrerequisites('mcp__linear__createIssue');
      expect(debugMessages.some((m) => m.includes('preparation required'))).toBe(true);
    });

    it('logs when a read is tracked', () => {
      manager.trackReadTool({ file_path: '/some/file.md' });
      expect(debugMessages.some((m) => m.includes('tracked read'))).toBe(true);
    });
  });

  describe('catalog skill reads', () => {
    it('resolves Read and cat of a catalog SKILL.md only', () => {
      manager.setCatalogSkills([
        {
          slug: 'vision',
          skillMdPath: '/ws/skills/vision/SKILL.md',
          requiredSources: ['qwen-mm'],
        },
      ]);

      expect(manager.findCatalogSkillForTool('Read', {
        file_path: '/ws/skills/vision/SKILL.md',
      })?.slug).toBe('vision');
      expect(manager.findCatalogSkillForTool('Bash', {
        command: 'cat "/ws/skills/vision/SKILL.md"',
      })?.requiredSources).toEqual(['qwen-mm']);
      expect(manager.findCatalogSkillForTool('Read', {
        file_path: '/ws/skills/other/SKILL.md',
      })).toBeNull();
      expect(manager.findCatalogSkillForTool('Write', {
        file_path: '/ws/skills/vision/SKILL.md',
      })).toBeNull();
    });
  });
});
