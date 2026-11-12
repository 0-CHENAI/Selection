/**
 * Explore-mode tool gate: MCP write tools must not slip through on substring
 * verbs, MCP suffix matching is limited to SubmitPlan, and unknown tools
 * default-deny. Pi listing tools (Find/Ls) stay allowed.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldAllowToolInMode } from '../../agent/mode-manager.ts';
import { shouldPromptInAskMode } from '../../agent/core/pre-tool-use.ts';
import { permissionsConfigCache } from '../../agent/permissions-config.ts';
import { PI_TOOL_NAME_MAP } from '../../agent/backend/pi/constants.ts';
import { getSessionSafeAllowedToolNames, getSessionSafeBlockedToolNames } from '@craft-agent/session-tools-core';

const REPO_ROOT = join(import.meta.dir, '../../../../..');
const BUNDLED_DEFAULT_PERMISSIONS = join(REPO_ROOT, 'apps/electron/resources/permissions/default.json');
const configDirs: string[] = [];

afterEach(() => {
  permissionsConfigCache.clear();
  const previous = process.env.CRAFT_CONFIG_DIR;
  for (const dir of configDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (previous === undefined) delete process.env.CRAFT_CONFIG_DIR;
});

function withDefaultPermissions() {
  const configDir = mkdtempSync(join(tmpdir(), 'selection-explore-tools-'));
  configDirs.push(configDir);
  const permissionsDir = join(configDir, 'permissions');
  mkdirSync(permissionsDir, { recursive: true });
  writeFileSync(
    join(permissionsDir, 'default.json'),
    readFileSync(BUNDLED_DEFAULT_PERMISSIONS),
  );
  process.env.CRAFT_CONFIG_DIR = configDir;
  permissionsConfigCache.clear();
  return {
    permissionsContext: { workspaceRootPath: join(configDir, 'workspace'), activeSourceSlugs: [] },
  };
}

describe('Explore mode MCP and unknown-tool gate', () => {
  it('blocks write tools that substring-matched default.json read verbs', () => {
    const options = withDefaultPermissions();
    const writeTools = [
      'mcp__slack__send_thread_reply',
      'mcp__sheets__update_spreadsheet',
      'mcp__admin__delete_account',
      'mcp__budget__create_entry',
      'mcp__github__get_or_create_issue',
    ];
    for (const toolName of writeTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe', options);
      expect(result.allowed).toBe(false);
    }
  });

  it('still allows genuine read-only MCP tools from the default verbs', () => {
    const options = withDefaultPermissions();
    for (const toolName of [
      'mcp__slack__get_channel',
      'mcp__linear__list_issues',
      'mcp__docs__search_pages',
    ]) {
      expect(shouldAllowToolInMode(toolName, {}, 'safe', options).allowed).toBe(true);
    }
  });

  it('limits the always-allowed MCP suffix to SubmitPlan', () => {
    expect(shouldAllowToolInMode('mcp__plan__SubmitPlan', {}, 'safe').allowed).toBe(true);
    expect(shouldAllowToolInMode('mcp__untrusted__Read', {}, 'safe').allowed).toBe(false);
    expect(shouldAllowToolInMode('mcp__untrusted__Glob', {}, 'safe').allowed).toBe(false);
    expect(shouldAllowToolInMode('mcp__untrusted__WebSearch', {}, 'safe').allowed).toBe(false);
  });

  it('default-denies unknown tools in Explore and still allows them in Ask', () => {
    expect(shouldAllowToolInMode('UnknownMutatingTool', {}, 'safe').allowed).toBe(false);
    expect(shouldAllowToolInMode('UnknownMutatingTool', {}, 'ask').allowed).toBe(true);
  });

  it('keeps every mapped Pi builtin and safe session tool allowed in Explore', () => {
    const options = withDefaultPermissions();
    const readOnlyPiTools = new Set([
      'Read', 'Grep', 'Glob', 'Find', 'Ls', 'WebFetch', 'WebSearch', 'Task',
    ]);
    const writePiTools = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
    for (const mapped of Object.values(PI_TOOL_NAME_MAP)) {
      const input = mapped === 'Bash' ? { command: 'ls' } : {};
      const result = shouldAllowToolInMode(mapped, input, 'safe', options);
      if (writePiTools.has(mapped)) {
        expect(result.allowed).toBe(false);
      } else if (readOnlyPiTools.has(mapped) || mapped === 'Bash') {
        expect(result.allowed).toBe(true);
      }
    }

    expect(shouldAllowToolInMode('list_mcp_resources', {}, 'safe').allowed).toBe(true);
    expect(shouldAllowToolInMode('read_mcp_resource', {}, 'safe').allowed).toBe(true);

    expect(shouldAllowToolInMode('Find', {}, 'safe').allowed).toBe(true);
    expect(shouldAllowToolInMode('Ls', {}, 'safe').allowed).toBe(true);
    expect(shouldAllowToolInMode('session_history', {}, 'safe').allowed).toBe(true);
    expect(shouldAllowToolInMode('task_context', {}, 'safe').allowed).toBe(true);
    expect(shouldAllowToolInMode('document_index', {}, 'safe').allowed).toBe(true);
    expect(shouldAllowToolInMode('document_read', {}, 'safe').allowed).toBe(true);

    for (const toolName of getSessionSafeAllowedToolNames()) {
      expect(shouldAllowToolInMode(toolName, {}, 'safe').allowed).toBe(true);
    }
    for (const toolName of getSessionSafeBlockedToolNames()) {
      expect(shouldAllowToolInMode(toolName, {}, 'safe').allowed).toBe(false);
    }
  });

  it('Ask mode prompts for MCP suffix tools that are not SubmitPlan', () => {
    const permissionManager = {
      isCommandWhitelisted: () => false,
      isDangerousCommand: () => false,
      getBaseCommand: (command: string) => command,
      extractDomainFromNetworkCommand: () => null,
      isDomainWhitelisted: () => false,
    };
    const permissionsContext = { workspaceRootPath: '/tmp/selection-explore-ask' };
    expect(shouldPromptInAskMode('mcp__plan__SubmitPlan', {}, permissionManager, permissionsContext)).toBeNull();
    expect(shouldPromptInAskMode('mcp__untrusted__Task', {}, permissionManager, permissionsContext)).toMatchObject({
      promptType: 'mcp_mutation',
      command: 'mcp__untrusted__Task',
    });
  });
});
