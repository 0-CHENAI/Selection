/**
 * Tests for send_developer_feedback tool permission handling across permission modes.
 *
 * send_developer_feedback is an external persistent side effect. When its
 * feature flag is enabled it must remain blocked in safe mode and require a
 * visible, per-message confirmation in every executable permission mode.
 */
import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import { shouldAllowToolInMode } from '../../agent/mode-manager.ts';
import {
  runPreToolUseChecks,
  shouldPromptInAskMode,
  type PermissionManagerLike,
} from '../../agent/core/pre-tool-use.ts';
import { setPermissionMode } from '../../agent/mode-manager.ts';

const FLAG_ENV = 'CRAFT_FEATURE_DEVELOPER_FEEDBACK';

describe('send_developer_feedback permission mode handling', () => {
  const toolName = 'mcp__session__send_developer_feedback';
  const input = { message: 'Feedback content' };
  const permissionManager: PermissionManagerLike = {
    isCommandWhitelisted: () => false,
    isDangerousCommand: () => false,
    getBaseCommand: command => command,
    extractDomainFromNetworkCommand: () => null,
    isDomainWhitelisted: () => false,
  };

  let originalFlag: string | undefined;

  beforeAll(() => {
    originalFlag = process.env[FLAG_ENV];
    process.env[FLAG_ENV] = '1';
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env[FLAG_ENV];
    else process.env[FLAG_ENV] = originalFlag;
  });

  it('is blocked in safe (Explore) mode', () => {
    const result = shouldAllowToolInMode(toolName, input, 'safe');
    expect(result.allowed).toBe(false);
  });

  it('requires a prompt in ask mode and previews the exact message', () => {
    const result = shouldPromptInAskMode(
      toolName,
      input,
      permissionManager,
      { workspaceRootPath: '/workspace' },
    );
    expect(result).toMatchObject({
      promptType: 'mcp_mutation',
      command: toolName,
    });
    expect(result?.description).toContain(input.message);
    expect(result?.description).toContain('Session and connection metadata are not included');
  });

  for (const mode of ['safe', 'ask', 'allow-all'] as const) {
    it(`requires a per-message prompt in ${mode} mode`, () => {
      const sessionId = `feedback-${mode}`;
      setPermissionMode(sessionId, mode);
      const result = runPreToolUseChecks({
        toolName,
        input,
        sessionId,
        permissionMode: mode,
        workspaceRootPath: '/workspace',
        workspaceId: 'workspace',
        activeSourceSlugs: [],
        allSourceSlugs: [],
        hasSourceActivation: false,
        permissionManager,
      });
      expect(result).toMatchObject({
        type: 'prompt',
        promptType: 'mcp_mutation',
        command: toolName,
      });
      if (result.type === 'prompt') {
        expect(result.description).toContain(input.message);
      }
    });
  }

  it('does not let a stored whitelist bypass the confirmation', () => {
    const whitelistedManager: PermissionManagerLike = {
      ...permissionManager,
      isCommandWhitelisted: () => true,
    };
    const result = shouldPromptInAskMode(
      toolName,
      input,
      whitelistedManager,
      { workspaceRootPath: '/workspace' },
    );
    expect(result?.description).toContain(input.message);
  });

  it('applies the same prompt contract to the canonical tool name', () => {
    const result = shouldPromptInAskMode(
      'send_developer_feedback',
      input,
      permissionManager,
      { workspaceRootPath: '/workspace' },
    );
    expect(result).toMatchObject({
      promptType: 'mcp_mutation',
      command: 'send_developer_feedback',
    });
  });
});
