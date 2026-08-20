/**
 * Regression tests for metadata-driven session tool safe-mode classification.
 */
import { describe, it, expect } from 'bun:test';
import { shouldAllowToolInMode } from '../../agent/mode-manager.ts';
import { shouldPromptInAskMode, type PermissionManagerLike } from '../../agent/core/pre-tool-use.ts';

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
      'mcp__session__office_document_inspect',
      'mcp__session__get_task_results',
      'office_document_inspect',
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
      'mcp__session__office_document_edit',
      'office_document_edit',
    ] as const;

    for (const toolName of blockedTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('blocked in');
      }
    }
  });

  it('prompts for Office document edits but not inspections in ask mode', () => {
    const permissionManager: PermissionManagerLike = {
      isCommandWhitelisted: () => false,
      isDangerousCommand: () => false,
      getBaseCommand: command => command,
      extractDomainFromNetworkCommand: () => null,
      isDomainWhitelisted: () => false,
    };
    const permissionsContext = { workspaceRootPath: '/workspace' };

    expect(shouldPromptInAskMode(
      'mcp__session__office_document_inspect',
      { command: 'view' },
      permissionManager,
      permissionsContext,
    )).toBeNull();
    expect(shouldPromptInAskMode(
      'mcp__session__office_document_edit',
      { command: 'create' },
      permissionManager,
      permissionsContext,
    )).toMatchObject({
      promptType: 'mcp_mutation',
      command: 'mcp__session__office_document_edit',
    });

    expect(shouldPromptInAskMode(
      'office_document_inspect',
      { command: 'view' },
      permissionManager,
      permissionsContext,
    )).toBeNull();
    expect(shouldPromptInAskMode(
      'office_document_edit',
      { command: 'create' },
      permissionManager,
      permissionsContext,
    )).toMatchObject({
      promptType: 'mcp_mutation',
      command: 'office_document_edit',
    });
  });
});
