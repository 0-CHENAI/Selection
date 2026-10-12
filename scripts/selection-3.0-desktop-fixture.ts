#!/usr/bin/env bun
/** Disposable local desktop samples; inject missing legacy fields only before opening the app. */
import { join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { addWorkspace, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config';
import { createSession, saveSession, loadSession, getSessionFilePath } from '@craft-agent/shared/sessions';
import { loadWorkspaceConfig, saveWorkspaceConfig } from '@craft-agent/shared/workspaces';
const recordPath = process.env.DESKTOP_RECORD ?? '/tmp/selection-version-3.0/457-desktop-fixture.json';
if (existsSync(recordPath)) {
  console.log(readFileSync(recordPath, 'utf8'));
  process.exit(0);
}
const rootPath = '/tmp/selection-version-3.0/desktop-workspace', connection = getLlmConnections().find(c => c.slug === getDefaultLlmConnection())!;
const workspace = addWorkspace({ rootPath, name: 'Selection 3.0 QA' });
const config = loadWorkspaceConfig(rootPath)!;
config.defaults = { ...config.defaults, model: connection.defaultModel, defaultLlmConnection: connection.slug, permissionMode: 'safe', thinkingLevel: 'low' };
saveWorkspaceConfig(rootPath, config);
const common = { permissionMode: 'safe' as const, model: connection.defaultModel, llmConnection: connection.slug, workingDirectory: resolve(import.meta.dir, 'fixtures/selection-3.0') };
const plain = await createSession(rootPath, { ...common, name: '历史普通对话' }), pro = await createSession(rootPath, { ...common, name: '历史 PRO 根', taskDraft: true, swarmEnabled: true }), worker = await createSession(rootPath, { ...common, name: '历史独立 reviewer', parentSessionId: pro.id, orchestrationRootSessionId: pro.id, orchestrationRole: 'reviewer', orchestrationLifecycle: 'managed', orchestrationStatus: 'completed' }), orphan = await createSession(rootPath, { ...common, name: '待核对缺失根', parentSessionId: 'missing-root', taskNodeId: 'historical-node' });
for (const session of [plain, pro, worker, orphan]) {
  const stored = loadSession(rootPath, session.id)!;
  stored.messages = [{ id: `fixture-${session.id}`, type: 'user', content: '历史迁移测试：只分析、不部署，保留原 safe 权限和模型。', timestamp: Date.now() }];
  if (session.id === plain.id)
    stored.messages.push({ id: 'desktop-links', type: 'assistant', timestamp: Date.now(), content: `桌面验收链接：[PRO 根与长内容](craftagents://workspace/${workspace.id}/allSessions/session/${pro.id}?window=focused) · [独立 reviewer](craftagents://workspace/${workspace.id}/allSessions/session/${worker.id}) · [缺失根 worker](craftagents://workspace/${workspace.id}/allSessions/session/${orphan.id})` });
  if (session.id === pro.id)
    stored.messages.push({ id: 'desktop-long', type: 'assistant', timestamp: Date.now(), content: Array.from({ length: 24 }, (_, i) => `第${i + 1}段：历史长内容验收。原模型和 safe 权限保留；两个年度的成本资料与风险未知状态不能凭窗口变化而丢失。` + ' 这是一段用于核对换行和滚动的中文内容。'.repeat(5)).join('\n\n') });
  await saveSession(stored);
  const path = getSessionFilePath(rootPath, session.id), lines = readFileSync(path, 'utf8').trim().split('\n'), header = JSON.parse(lines[0]!);
  delete header.workMode;
  delete header.workModeNeedsReview;
  delete header.executionRootSessionId;
  lines[0] = JSON.stringify(header);
  writeFileSync(path, lines.join('\n') + '\n');
}
const f7 = await createSession(rootPath, { ...common, name: 'F7 两年成本与风险', workMode: 'NORM', swarmEnabled: false });
const record = { workspace, model: connection.defaultModel, connection: connection.slug, permissionMode: 'safe', legacy: { plain: plain.id, pro: pro.id, worker: worker.id, orphan: orphan.id }, f7: f7.id, fixture: join(common.workingDirectory, 'costs.txt'), createdAt: Date.now() };
writeFileSync(recordPath, JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
