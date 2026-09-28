import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBundledSkillMdPath, loadAllSkills } from '../../skills/storage.ts';
import { toSkillCatalogEntries } from '../../skills/catalog.ts';
import { TestAgent, createMockBackendConfig, createMockWorkspace, collectEvents } from './test-utils.ts';

class WritingAgent extends TestAgent {
  markSkillRead(path: string) { this.prerequisiteManager.trackReadTool({ file_path: path }); }
  hasRead(path: string) { return this.prerequisiteManager.hasRead(path); }
  discover(path: string) { return this.prerequisiteManager.findCatalogSkillForTool('Read', { file_path: path }); }
  canWrite() { return this.prerequisiteManager.checkPrerequisites('Write').allowed; }
}

describe('natural writing skill integration', () => {
  it('ships a discoverable, compact skill instead of adding its body to every message', () => {
    const entries = toSkillCatalogEntries(loadAllSkills('/test/writing-workspace'));
    const entry = entries.find(e => e.slug === 'natural-writing');
    expect(entry).toBeDefined();
    const content = readFileSync(entry!.skillMdPath, 'utf8');
    expect(content.length).toBeLessThan(2000);
    expect(entry!.description.length).toBeLessThan(250);
    expect(entry!.description).not.toContain('交付前一次检查');
  });

  it('supports model-selected catalog reads and resets reading state after compaction', async () => {
    const agent = new WritingAgent(createMockBackendConfig());
    try {
      await collectEvents(agent.chat('把第二段改自然些'));
      const path = resolveBundledSkillMdPath('natural-writing')!;
      expect(agent.discover(path)?.slug).toBe('natural-writing');
      expect(agent.hasRead(path)).toBe(false);
      agent.markSkillRead(path);
      await collectEvents(agent.chat('再短一些'));
      expect(agent.hasRead(path)).toBe(true);
      agent.resetPrerequisiteState();
      expect(agent.hasRead(path)).toBe(false);
      expect(agent.discover(path)?.slug).toBe('natural-writing');
    } finally { agent.destroy(); }
  });

  it('retains explicit skill selection and cooperates with the Office router', async () => {
    const agent = new WritingAgent(createMockBackendConfig());
    try {
      const turn = agent.chat('[skill:natural-writing] 帮我润色报告.docx');
      await turn.next();
      expect(agent.chatCalls[0]!.message).toContain('(slug: natural-writing)');
      expect(agent.chatCalls[0]!.message).toContain('(skill: officecli)');
      expect(agent.chatCalls[0]!.message).not.toContain('## 写作与修订');
      const stableContext = agent.getPromptBuilder().buildStableContextParts().join('\n');
      expect(stableContext).toContain('The user explicitly selected natural-writing');
      expect(stableContext).toContain('## 写作与修订');
      expect(agent.canWrite()).toBe(false);
      agent.markSkillRead(resolveBundledSkillMdPath('officecli')!);
      expect(agent.canWrite()).toBe(true);
      agent.resetPrerequisiteState();
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).toContain('## 写作与修订');
      await turn.next();
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).not.toContain('## 写作与修订');
    } finally { agent.destroy(); }
  });

  it('does not keep explicitly selected writing rules in the next unrelated turn', async () => {
    const agent = new WritingAgent(createMockBackendConfig());
    try {
      const turn = agent.chat('[skill:natural-writing] 修改文章正文');
      await turn.next();
      expect(agent.canWrite()).toBe(true);
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).toContain('## 写作与修订');
      await turn.next();
      await collectEvents(agent.chat('修复编译器错误'));
      expect(agent.chatCalls[1]!.message).not.toContain('## 写作与修订');
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).not.toContain('## 写作与修订');
    } finally { agent.destroy(); }
  });

  it('restores explicit selection for same-task recovery on a recreated agent', async () => {
    const original = '[skill:natural-writing] 修改文章正文';
    const agent = new WritingAgent(createMockBackendConfig());
    try {
      const recovery = agent.chat('请继续完成并提交答案', undefined,
        { continueUserTask: true, userTaskMessage: original });
      await recovery.next();
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).toContain('## 写作与修订');
      expect(agent.chatCalls[0]!.message).not.toContain('## 写作与修订');
      await recovery.next();
      const next = agent.chat('修复编译器错误');
      await next.next();
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).not.toContain('## 写作与修订');
      await next.next();
    } finally { agent.destroy(); }
  });

  it('does not let an older chat cleanup clear a newer turn', async () => {
    const agent = new WritingAgent(createMockBackendConfig());
    try {
      const older = agent.chat('[skill:natural-writing] 修改旧稿');
      await older.next();
      const newer = agent.chat('[skill:natural-writing] 修改新稿');
      await newer.next();
      await older.next();
      expect(agent.getCurrentTurnUserMessage()).toContain('修改新稿');
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).toContain('## 写作与修订');
      await newer.next();
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).not.toContain('## 写作与修订');
    } finally { agent.destroy(); }
  });

  it('keeps a workspace override at its existing Read trust level', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'writing-skill-override-'));
    const skillDir = join(workspaceRoot, 'skills', 'natural-writing');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Custom writing\ndescription: Workspace writing rules\n---\n\nCUSTOM_WRITING_RULES\n');
    const agent = new WritingAgent(createMockBackendConfig({ workspace: createMockWorkspace({ rootPath: workspaceRoot }) }));
    try {
      const turn = agent.chat('[skill:natural-writing] 修改文章正文');
      await turn.next();
      expect(agent.chatCalls[0]!.message).toContain(`${skillDir}/SKILL.md (skill: natural-writing)`);
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).not.toContain('CUSTOM_WRITING_RULES');
      expect(agent.canWrite()).toBe(false);
      await turn.next();
      const recovery = agent.chat('请继续', undefined,
        { continueUserTask: true, userTaskMessage: '[skill:natural-writing] 修改文章正文' });
      await recovery.next();
      expect(agent.chatCalls[1]!.message).toContain(`${skillDir}/SKILL.md (skill: natural-writing)`);
      expect(agent.getPromptBuilder().buildStableContextParts().join('\n')).not.toContain('CUSTOM_WRITING_RULES');
      await recovery.next();
    } finally {
      agent.destroy();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('leaves intent selection to the model instead of forcing keyword matches', async () => {
    const agent = new TestAgent(createMockBackendConfig());
    try {
      await collectEvents(agent.chat('读取报告.docx中的表格'));
      await collectEvents(agent.chat('请修复报告生成器的代码'));
      await collectEvents(agent.chat('写报告之前先检查这些数字，暂时不要写正文'));
      await collectEvents(agent.chat('帮我写一份报告'));
      for (const call of agent.chatCalls) expect(call.message).not.toContain('(skill: natural-writing)');
    } finally { agent.destroy(); }
  });
});
