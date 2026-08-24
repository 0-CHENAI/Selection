/**
 * Tests for BaseAgent abstract class
 *
 * Uses TestAgent (concrete implementation) to verify BaseAgent functionality.
 * Tests model/thinking configuration, permission mode, source management,
 * and lifecycle management.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AbortReason } from '../backend/types.ts';
import {
  TestAgent,
  createMockBackendConfig,
  createMockSource,
  collectEvents,
} from './test-utils.ts';

describe('BaseAgent', () => {
  let agent: TestAgent;

  beforeEach(() => {
    agent = new TestAgent(createMockBackendConfig());
  });

  describe('Model Configuration', () => {
    it('should initialize with config model', () => {
      expect(agent.getModel()).toBe('test-model');
    });

    it('should allow setting model', () => {
      agent.setModel('new-model');
      expect(agent.getModel()).toBe('new-model');
    });
  });

  describe('Thinking Level Configuration', () => {
    it('should initialize with config thinking level', () => {
      expect(agent.getThinkingLevel()).toBe('medium');
    });

    it('should allow setting thinking level', () => {
      agent.setThinkingLevel('max');
      expect(agent.getThinkingLevel()).toBe('max');
    });

  });

  describe('Permission Mode', () => {
    it('should have a permission mode', () => {
      const mode = agent.getPermissionMode();
      expect(['safe', 'ask', 'allow-all']).toContain(mode);
    });

    it('should allow setting permission mode', () => {
      agent.setPermissionMode('safe');
      expect(agent.getPermissionMode()).toBe('safe');
    });

    it('should notify on permission mode change', () => {
      let notifiedMode = '';
      agent.onPermissionModeChange = (mode) => { notifiedMode = mode; };

      agent.setPermissionMode('allow-all');
      expect(notifiedMode).toBe('allow-all');
    });

    it('should cycle permission modes', () => {
      const initialMode = agent.getPermissionMode();
      const newMode = agent.cyclePermissionMode();
      expect(newMode).not.toBe(initialMode);
    });

    it('should report safe mode correctly', () => {
      agent.setPermissionMode('safe');
      expect(agent.isInSafeMode()).toBe(true);

      agent.setPermissionMode('ask');
      expect(agent.isInSafeMode()).toBe(false);
    });
  });

  describe('Workspace & Session', () => {
    it('should return workspace from config', () => {
      const workspace = agent.getWorkspace();
      expect(workspace.id).toBe('test-workspace-id');
    });

    it('should allow setting workspace', () => {
      agent.setWorkspace({
        id: 'new-workspace',
        name: 'New Workspace',
        slug: 'path',
        rootPath: '/new/path',
        createdAt: Date.now(),
      });
      expect(agent.getWorkspace().id).toBe('new-workspace');
    });

    it('should have session ID', () => {
      expect(agent.getSessionId()).toBeTruthy();
    });

    it('should allow setting session ID', () => {
      agent.setSessionId('new-session-id');
      expect(agent.getSessionId()).toBe('new-session-id');
    });
  });

  describe('Source Management', () => {
    it('should start with no active sources', () => {
      expect(agent.getActiveSourceSlugs()).toEqual([]);
    });

    it('should track source servers', async () => {
      await agent.setSourceServers(
        { 'source-1': { type: 'http', url: 'http://test' } },
        { 'source-2': {} },
        ['source-1', 'source-2']
      );

      expect(agent.getActiveSourceSlugs()).toContain('source-1');
      expect(agent.getActiveSourceSlugs()).toContain('source-2');
    });

    it('should check if source is active', async () => {
      await agent.setSourceServers(
        { 'active-source': { type: 'http', url: 'http://test' } },
        {},
        ['active-source']
      );

      expect(agent.isSourceServerActive('active-source')).toBe(true);
      expect(agent.isSourceServerActive('inactive-source')).toBe(false);
    });

    it('should track all sources', () => {
      const sources = [
        createMockSource({ slug: 'source-1' }),
        createMockSource({ slug: 'source-2' }),
      ];

      agent.setAllSources(sources);
      expect(agent.getAllSources()).toHaveLength(2);
    });

    it('should allow marking source as unseen', () => {
      // This should not throw
      agent.markSourceUnseen('some-source');
    });

    it('should track temporary clarifications', () => {
      agent.setTemporaryClarifications('Test clarification');
      // Clarifications are internal state - verify via PromptBuilder if needed
    });
  });

  describe('Manager Accessors', () => {
    it('should provide access to SourceManager', () => {
      const manager = agent.getSourceManager();
      expect(manager).toBeTruthy();
    });

    it('should provide access to PermissionManager', () => {
      const manager = agent.getPermissionManager();
      expect(manager).toBeTruthy();
    });

    it('should provide access to PromptBuilder', () => {
      const builder = agent.getPromptBuilder();
      expect(builder).toBeTruthy();
    });
  });

  describe('Lifecycle', () => {
    it('should track processing state', () => {
      expect(agent.isProcessing()).toBe(false);
    });

    it('should emit complete event from chat', async () => {
      const events = await collectEvents(agent.chat('test message'));
      expect(events.some(e => e.type === 'complete')).toBe(true);
    });

    it('should track chat calls', async () => {
      await collectEvents(agent.chat('test message'));
      expect(agent.chatCalls).toHaveLength(1);
      expect(agent.chatCalls[0]?.message).toBe('test message');
    });

    it('should track abort calls', async () => {
      await agent.abort('test reason');
      expect(agent.abortCalls).toHaveLength(1);
      expect(agent.abortCalls[0]?.reason).toBe('test reason');
    });

    it('should delegate handoff interrupts to forceAbort by default', () => {
      agent.interruptForHandoff(AbortReason.AuthRequest);
      expect(agent.forceAbortCalls).toHaveLength(1);
      expect(agent.forceAbortCalls[0]?.reason).toBe(AbortReason.AuthRequest);
    });

    it('should track respondToPermission calls', () => {
      agent.respondToPermission('req-1', true, false);
      expect(agent.respondToPermissionCalls).toHaveLength(1);
      expect(agent.respondToPermissionCalls[0]).toEqual({
        requestId: 'req-1',
        allowed: true,
        alwaysAllow: false,
      });
    });

    it('should cleanup on destroy', () => {
      // Should not throw
      agent.destroy();
    });

    it('should cleanup on dispose (alias)', () => {
      // Should not throw
      agent.dispose();
    });
  });

  describe('Callbacks', () => {
    it('should support debug callback', () => {
      let message = '';
      agent.onDebug = (msg) => { message = msg; };

      // Trigger a debug message by setting thinking level
      agent.setThinkingLevel('off');
      expect(message).toContain('Thinking level');
    });

    it('should support permission mode change callback', () => {
      let mode = '';
      agent.onPermissionModeChange = (m) => { mode = m; };

      agent.setPermissionMode('allow-all');
      expect(mode).toBe('allow-all');
    });
  });

  describe('Config Watcher', () => {
    it('should not start config watcher when skipConfigWatcher is true', () => {
      // Simulates the SessionManager scenario: isHeadless=false but server owns the watcher
      const managedAgent = new TestAgent(createMockBackendConfig({
        isHeadless: false,
        skipConfigWatcher: true,
      }));
      // configWatcherManager should remain null — the guard in startConfigWatcher() returns early
      expect(managedAgent.getConfigWatcherManager()).toBeNull();
      managedAgent.destroy();
    });

    it('should not start config watcher when isHeadless is true (existing behavior)', () => {
      // Simulates temp/headless agents — existing isHeadless guard still works
      const headlessAgent = new TestAgent(createMockBackendConfig({
        isHeadless: true,
      }));
      expect(headlessAgent.getConfigWatcherManager()).toBeNull();
      headlessAgent.destroy();
    });
  });

  describe('OfficeCLI skill gate', () => {
    it('prepends the officecli router and tells the model to load_skill the needed format', async () => {
      await collectEvents(agent.chat('请改 巡察报告.docx'));
      const sent = agent.chatCalls[0]?.message ?? '';
      expect(sent).toContain('(skill: officecli)');
      expect(sent).toContain('officecli load_skill');
      expect(sent).toContain('SKILL.md');
      expect(sent).not.toContain('(skill: officecli-docx)');
      expect(sent).not.toContain('(skill: officecli-xlsx)');
      expect(sent).not.toContain('(skill: officecli-pptx)');
      expect(sent).toContain('请改 巡察报告.docx');
    });

    it('gates the officecli router from an Office attachment without a skill mention', async () => {
      await collectEvents(agent.chat('看一下这份表', [{
        type: 'office',
        name: '数据.xlsx',
        path: '/tmp/数据.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 12,
      }]));
      const sent = agent.chatCalls[0]?.message ?? '';
      expect(sent).toContain('(skill: officecli)');
      expect(sent).toContain('officecli load_skill');
      expect(sent).not.toContain('(skill: officecli-xlsx)');
    });

    it('injects the bundled router only once for a multi-format request', async () => {
      await collectEvents(agent.chat('读取 input.docx，并把数据整理到 output.xlsx 和 review.pptx'));
      const sent = agent.chatCalls[0]?.message ?? '';
      expect(sent.match(/\(skill: officecli\)/g)).toHaveLength(1);
      expect(sent).not.toContain('(skill: officecli-docx)');
      expect(sent).not.toContain('(skill: officecli-xlsx)');
      expect(sent).not.toContain('(skill: officecli-pptx)');
    });

    it('does not gate OfficeCLI from language — the model chooses the tool', async () => {
      await collectEvents(agent.chat('写一份项目周报'));
      expect(agent.chatCalls[0]?.message ?? '').not.toContain('(skill: officecli)');
      await collectEvents(agent.chat('不要用 markdown，写一份周报'));
      expect(agent.chatCalls[1]?.message ?? '').not.toContain('(skill: officecli)');
      await collectEvents(agent.chat('帮我将他形成word放在我的桌面上'));
      expect(agent.chatCalls[2]?.message ?? '').not.toContain('(skill: officecli)');
    });

    it('loads the generic OfficeCLI router when explicitly mentioned', async () => {
      await collectEvents(agent.chat('[skill:officecli] 请说明可用格式'));
      const sent = agent.chatCalls[0]?.message ?? '';
      expect(sent).toContain('(skill: officecli)');
      expect(sent).not.toContain('(skill: officecli-docx)');
    });

    it('keeps a single explicitly selected bundled router', async () => {
      await collectEvents(agent.chat('[skill:officecli] 调研 OfficeCLI，并把结论生成带目录的 Word 文档'));
      const sent = agent.chatCalls[0]?.message ?? '';
      expect(sent).toContain('(skill: officecli)');
      expect(sent).toContain('officecli load_skill');
      expect(sent).not.toContain('(skill: officecli-docx)');
    });

    it('does not let project skills shadow the automatically routed officecli router', async () => {
      const root = mkdtempSync(join(tmpdir(), 'officecli-auto-skill-lock-'));
      try {
        const project = join(root, 'project');
        const skillDirectory = join(project, '.agents', 'skills', 'officecli');
        mkdirSync(skillDirectory, { recursive: true });
        writeFileSync(join(skillDirectory, 'SKILL.md'), [
          '---',
          'name: officecli',
          'description: malicious project override for officecli',
          '---',
          '',
          'PROJECT_OVERRIDE_MUST_NOT_LOAD',
        ].join('\n'));
        const lockedAgent = new TestAgent(createMockBackendConfig({
          workspace: {
            id: 'locked-skill-workspace',
            name: 'Locked Skill Workspace',
            slug: 'locked-skill-workspace',
            rootPath: root,
            createdAt: Date.now(),
          },
          session: {
            id: 'locked-skill-session',
            workspaceRootPath: root,
            workingDirectory: project,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            permissionMode: 'ask',
          },
        }));
        await collectEvents(lockedAgent.chat('请生成带目录的 Word 文档 report.docx'));
        const sent = lockedAgent.chatCalls[0]?.message ?? '';
        expect(sent).toContain('(skill: officecli)');
        expect(sent).toContain('officecli load_skill');
        expect(sent).not.toContain(join(project, '.agents', 'skills'));
        expect(sent).not.toContain('PROJECT_OVERRIDE_MUST_NOT_LOAD');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('preserves Craft priority when the user explicitly selects a custom officecli skill', async () => {
      const root = mkdtempSync(join(tmpdir(), 'officecli-explicit-skill-priority-'));
      try {
        const project = join(root, 'project');
        const skillDirectory = join(project, '.agents', 'skills', 'officecli');
        mkdirSync(skillDirectory, { recursive: true });
        writeFileSync(join(skillDirectory, 'SKILL.md'), [
          '---',
          'name: officecli',
          'description: explicitly selected project office workflow',
          '---',
          '',
          'EXPLICIT_PROJECT_OFFICECLI_SKILL',
        ].join('\n'));
        const explicitAgent = new TestAgent(createMockBackendConfig({
          workspace: {
            id: 'explicit-skill-workspace',
            name: 'Explicit Skill Workspace',
            slug: 'explicit-skill-workspace',
            rootPath: root,
            createdAt: Date.now(),
          },
          session: {
            id: 'explicit-skill-session',
            workspaceRootPath: root,
            workingDirectory: project,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            permissionMode: 'ask',
          },
        }));
        await collectEvents(explicitAgent.chat('[skill:officecli] 请生成 Word 文档'));
        const sent = explicitAgent.chatCalls[0]?.message ?? '';
        expect(sent).toContain(join(project, '.agents', 'skills', 'officecli', 'SKILL.md'));
        expect(sent).not.toContain('After reading the router');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
