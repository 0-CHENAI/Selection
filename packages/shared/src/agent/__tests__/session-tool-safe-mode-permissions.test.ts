/**
 * Regression tests for metadata-driven session tool safe-mode classification.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldAllowToolInMode } from '../../agent/mode-manager.ts';
import { shouldPromptInAskMode, type PermissionManagerLike } from '../../agent/core/pre-tool-use.ts';
import { permissionsConfigCache } from '../../agent/permissions-config.ts';

describe('session tool safe-mode classification', () => {
  // send_developer_feedback intentionally omitted — it is feature-flagged via
  // FEATURE_FLAGS.developerFeedback (off by default outside dev runtimes), so
  // its safe-mode visibility depends on env state. The dedicated suite at
  // send-developer-feedback-permissions.test.ts owns that flag-aware behavior.
  it('allows read-only session tools in safe mode', () => {
    const allowedTools = [
      'mcp__session__call_llm',
      'mcp__session__browser_tool',
      'mcp__session__script_sandbox',
      'mcp__session__get_task_results',
      'mcp__session__officecli_qa',
    ] as const;

    for (const toolName of allowedTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks mutating/auth session tools in safe mode', () => {
    const blockedTools = [
      'mcp__session__source_oauth_trigger',
      'mcp__session__source_credential_prompt',
      'mcp__session__spawn_session',
      'mcp__session__run_task',
      'mcp__session__update_user_preferences',
      'mcp__session__officecli_batch',
      'mcp__session__officecli_finalize',
    ] as const;

    for (const toolName of blockedTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('blocked in');
      }
    }
  });

  it('keeps read-only OfficeCLI fallback QA available when typed tools are feature-gated', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'selection-officecli-safe-'));
    const previousConfigDir = process.env.CRAFT_CONFIG_DIR;
    try {
      const permissionsDir = join(configDir, 'permissions');
      mkdirSync(permissionsDir, { recursive: true });
      writeFileSync(
        join(permissionsDir, 'default.json'),
        readFileSync(join(process.cwd(), 'apps/electron/resources/permissions/default.json')),
      );
      process.env.CRAFT_CONFIG_DIR = configDir;
      permissionsConfigCache.clear();
      const options = {
        permissionsContext: { workspaceRootPath: '/tmp/selection-officecli-safe', activeSourceSlugs: [] },
      };

      expect(shouldAllowToolInMode('Bash', {
        command: 'officecli validate "OfficeCLI 调研.docx" --json',
      }, 'safe', options).allowed).toBe(true);
      expect(shouldAllowToolInMode('Bash', {
        command: 'officecli view "OfficeCLI 调研.docx" outline --json',
      }, 'safe', options).allowed).toBe(true);
      for (const command of [
        'officecli view "OfficeCLI 调研.docx" screenshot --out /tmp/grid.png',
        'officecli view "OfficeCLI 调研.docx" html --out /tmp/report.html',
        'officecli query "OfficeCLI 调研.docx" /body --output /tmp/result.json',
        'officecli get "OfficeCLI 调研.docx" /body --save /tmp/result.json',
        'officecli query "OfficeCLI 调研.docx" /body --save=/tmp/result.json',
        'officecli validate "OfficeCLI 调研.docx" --json\nofficecli add x.docx /body --type paragraph',
      ]) {
        expect(shouldAllowToolInMode('Bash', { command }, 'safe', options).allowed).toBe(false);
      }
      expect(shouldAllowToolInMode('Bash', {
        command: 'officecli add "OfficeCLI 调研.docx" /body --type paragraph',
      }, 'safe', options).allowed).toBe(false);
      expect(shouldAllowToolInMode('Bash', {
        command: 'officecli batch "OfficeCLI 调研.docx" --input payload.json',
      }, 'safe', options).allowed).toBe(false);
    } finally {
      permissionsConfigCache.clear();
      if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
      else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('prompts for mutating session tools in ask mode', () => {
    const permissionManager: PermissionManagerLike = {
      isCommandWhitelisted: () => false,
      isDangerousCommand: () => false,
      getBaseCommand: command => command,
      extractDomainFromNetworkCommand: () => null,
      isDomainWhitelisted: () => false,
    };
    const permissionsContext = { workspaceRootPath: '/workspace' };

    expect(shouldPromptInAskMode(
      'mcp__session__get_task_results',
      { slug: 'demo' },
      permissionManager,
      permissionsContext,
    )).toBeNull();
    expect(shouldPromptInAskMode(
      'mcp__session__run_task',
      { slug: 'demo' },
      permissionManager,
      permissionsContext,
    )).toMatchObject({
      promptType: 'mcp_mutation',
      command: 'mcp__session__run_task',
    });
  });
});
