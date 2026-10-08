import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, updateProject } from '@craft-agent/shared/projects';
import { projectHistory } from './project-history';

test('G memory authorization, cross-workspace isolation, sibling independence, exact expansion, revocation and deletion', () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-memory-')), other = mkdtempSync(join(tmpdir(), 'selection-memory-other-'));
  const project = createProject(root, { name: '验收项目' });
  const requester = { id: 'reader', workMode: 'PRO' as const, projectId: project.id, executionRootSessionId: 'root' };
  const write = (id: string, content: string, extra = {}, directory = root) => {
    mkdirSync(join(directory, 'sessions', id), { recursive: true });
    writeFileSync(join(directory, 'sessions', id, 'session.jsonl'), `${JSON.stringify({ id, projectId: project.id, workspaceRootPath: directory, createdAt: 1, lastUsedAt: 1, ...extra })}\n${JSON.stringify({ id: 'message', type: 'assistant', content, timestamp: 1 })}\n`);
  };
  try {
    write('past', 'COST_SCOPE_TEST: 金额必须使用人民币两年总额。 api_key=sk-private-token-secret');
    write('sibling', 'COST_SCOPE_TEST: 不应泄露兄弟节点', { executionRootSessionId: 'root' });
    write('other-project', 'COST_SCOPE_TEST: 不应泄露其他项目', { projectId: 'other' });
    write('foreign', 'COST_SCOPE_TEST: 外工作区', {}, other);
    symlinkSync(join(other, 'sessions', 'foreign'), join(root, 'sessions', 'foreign'));
    writeFileSync(join(root, 'sessions', 'past', 'orphan.tmp'), 'preserve');
    expect(() => projectHistory(root, requester, { query: 'COST_SCOPE_TEST' })).toThrow('disabled');
    updateProject(root, project.slug, { historySearchEnabled: true });
    expect(() => projectHistory(root, { ...requester, workMode: 'NORM' }, { query: 'COST_SCOPE_TEST' })).toThrow('PRO');
    expect(() => projectHistory(root, requester, {})).toThrow('specific');
    const result = projectHistory(root, requester, { query: 'COST_SCOPE_TEST' }) as any;
    expect(result.hits.map((hit: any) => hit.sessionId)).toEqual(['past']);
    expect(result.hits[0].excerpt).not.toContain('sk-private');
    const hit = result.hits[0];
    const input = { sessionId: hit.sessionId, messageId: hit.messageId, expectedVersion: hit.version };
    expect(projectHistory(root, requester, input)).toMatchObject({ verifiedEvidence: false, text: expect.stringContaining('人民币两年总额') });
    expect(readdirSync(join(root, 'sessions', 'past'))).toContain('orphan.tmp');
    // A new callback invocation is the restart path; no in-memory index survives.
    expect(projectHistory(root, requester, { query: 'COST_SCOPE_TEST' })).toEqual(result);
    const historyPath = join(root, 'sessions', 'past', 'session.jsonl');
    const [header, original] = readFileSync(historyPath, 'utf8').trim().split('\n');
    const message = JSON.parse(original!);
    writeFileSync(historyPath, `${header}\n${JSON.stringify({ content: message.content, timestamp: message.timestamp, type: message.type, id: message.id })}\n`);
    expect(projectHistory(root, requester, { query: 'COST_SCOPE_TEST' })).toEqual(result);
    expect(projectHistory(root, requester, input)).toMatchObject({ version: hit.version, text: expect.stringContaining('人民币两年总额') });
    write('past', 'COST_SCOPE_TEST: 已更正');
    expect(() => projectHistory(root, requester, input)).toThrow('changed/deleted');
    rmSync(join(root, 'sessions', 'past'), { recursive: true });
    expect((projectHistory(root, requester, { query: 'COST_SCOPE_TEST' }) as any).hits).toEqual([]);
    updateProject(root, project.slug, { historySearchEnabled: false });
    expect(() => projectHistory(root, requester, input)).toThrow('disabled');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});
