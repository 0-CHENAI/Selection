import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolveBundledSkillMdPath, loadAllSkills } from '../../skills/storage.ts';
import { toSkillCatalogEntries } from '../../skills/catalog.ts';
import { TestAgent, createMockBackendConfig, collectEvents } from './test-utils.ts';

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
      await collectEvents(agent.chat('[skill:natural-writing] 帮我润色报告.docx'));
      expect(agent.chatCalls[0]!.message).toContain('(skill: natural-writing)');
      expect(agent.chatCalls[0]!.message).toContain('(skill: officecli)');
      expect(agent.canWrite()).toBe(false);
      agent.markSkillRead(resolveBundledSkillMdPath('natural-writing')!);
      agent.markSkillRead(resolveBundledSkillMdPath('officecli')!);
      expect(agent.canWrite()).toBe(true);
    } finally { agent.destroy(); }
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
