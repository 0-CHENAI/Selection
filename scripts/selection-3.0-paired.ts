#!/usr/bin/env bun
/** Identical ordinary tasks on frozen baseline/current code. No research-specific mechanism is assumed. */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config';
import { setBundledAssetsRoot } from '@craft-agent/shared/utils';
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions';
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime';
const repo = resolve(import.meta.dir, '..'), fixture = process.env.PAIR_FIXTURE!, label = process.env.PAIR_LABEL!, recordPath = process.env.PAIR_RECORD!;
if (!fixture || !label || !recordPath)
  throw new Error('PAIR_FIXTURE, PAIR_LABEL and PAIR_RECORD required');
const ws = getWorkspaces()[0]!, connection = getLlmConnections().find(c => c.slug === getDefaultLlmConnection())!;
setBundledAssetsRoot(join(repo, 'apps/electron'));
setSessionPlatform(createHeadlessPlatform());
const manager = new SessionManager(), usageEvents: unknown[] = [], results: unknown[] = [];
manager.setEventSink((_channel, _target, ...args) => { const e = args.find(e => e && typeof e === 'object' && 'type' in e); if (e?.type === 'usage_update')
  usageEvents.push({ sessionId: e.sessionId, at: Date.now(), tokenUsage: structuredClone(e.tokenUsage) }); });
const common = `只允许使用 Read 读取固定资料 ${JSON.stringify(fixture)}；不得改文件、委派、部署或调用外部服务。资料仅供测试。`;
const cases = [
  { id: 'simple-read', turns: [`${common} 请确认方案 A 两年总成本，用人民币元和万元表示，并给出原文行号。简短中文回答。`] },
  { id: 'dual-compare', turns: [`${common} 请在成本和风险两维比较 A/B。明确每个关键事实的原文行号、哪些维度足以支持结论、哪些尚未覆盖；资料不足不要作总体推荐。简短中文回答。`] },
  { id: 'wrong-critical-revision', turns: ['这是验收的人工错误注入：请只回复“待审查的错误结论：A 两年成本为 100000 元（10 万元）”。这条是未核验的测试记录，本轮不要调用工具。', `${common} 现在核查上一条关键结论。独立读取原文，指出是否矛盾，给出修订后的数值和原文行号；不要把旧结论继续当成正确依据，并明确风险和 B 口径缺口。简短中文回答。`] }
];
const record = { label, codeSha: process.env.PAIR_SHA, model: connection.defaultModel, connection: connection.slug, thinkingLevel: 'low', permissionMode: 'safe', allowedTools: ['Read', 'session_history', 'mcp__session__submit_answer'], fixture: { path: fixture, sha256: createHash('sha256').update(readFileSync(fixture)).digest('hex') }, cases, startedAt: Date.now(), results, usageEvents };
try {
  await manager.reinitializeAuth();
  for (const item of cases) {
    const startedAt = Date.now(), session = await manager.createSession(ws.id, { name: `3.0 paired ${label} ${item.id}`, hidden: true, swarmEnabled: false, workMode: 'NORM', permissionMode: 'safe', thinkingLevel: 'low', workingDirectory: resolve(fixture, '..'), model: connection.defaultModel, llmConnection: connection.slug });
    let error: string | undefined;
    const outputs = [];
    try {
      for (const prompt of item.turns) {
        await manager.sendMessage(session.id, prompt);
        outputs.push(manager.getSessionFinalText(session.id));
      }
    }
    catch (e) {
      error = String(e);
      await manager.cancelProcessing(session.id, true).catch(() => { });
    }
    await manager.flushAllSessions();
    const actual = await manager.getSession(session.id);
    results.push({ caseId: item.id, sessionId: session.id, startedAt, completedAt: Date.now(), error, outputs, tokenUsage: actual?.tokenUsage, tools: actual?.messages.filter(m => m.toolName).map(m => ({ toolName: m.toolName, input: m.toolInput, isError: m.isError, status: m.toolStatus, result: m.toolName === 'Read' ? m.toolResult : undefined })) });
    writeFileSync(recordPath, JSON.stringify({ ...record, updatedAt: Date.now() }, null, 2));
    console.log(JSON.stringify({ label, caseId: item.id, sessionId: session.id, error, output: outputs.at(-1) }));
  }
}
finally {
  await manager.flushAllSessions();
  manager.cleanup();
  writeFileSync(recordPath, JSON.stringify({ ...record, completedAt: Date.now() }, null, 2));
}
process.exit(0);
