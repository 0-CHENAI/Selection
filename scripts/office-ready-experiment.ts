/** Real Selection agent run against the fixed report from gentle-cedar. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getWorkspaces } from '@craft-agent/shared/config';
import { setBundledAssetsRoot } from '@craft-agent/shared/utils';
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions';
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime';
const repo = resolve(import.meta.dir, '..');
const root = '/tmp/selection-office-ready-experiment';
mkdirSync(root, { recursive: true });
setBundledAssetsRoot(join(repo, 'apps/electron'));
setSessionPlatform(createHeadlessPlatform());
const manager = new SessionManager();
const ws = getWorkspaces().find(w => w.rootPath.endsWith('/my-workspace'))!;
let id: string | undefined;
const started = Date.now();
try {
 await manager.reinitializeAuth();
 const session = await manager.createSession(ws.id, { name: 'Word 快速交付实测', hidden: true, swarmEnabled: false, workMode: 'PRO', permissionMode: 'allow-all', thinkingLevel: 'max', workingDirectory: root, model: 'Laufry', llmConnection: 'pi-api-key' });
 id = session.id; console.log('SESSION', id);
 await manager.sendMessage(id, `请将 ${root}/report-source.txt 中的完整报告制作成一份专业、好看的中文 Word 技术报告，保存为 ${root}/Agent-TODO-快速交付实测.docx。采用 style-system-design 模板，保留完整正文和比较表格。资料已经确定，不重新联网调研，不更改内容事实。请生成并交付文件。`);
 await manager.flushAllSessions();
 const actual = await manager.getSession(id);
 const tools = actual?.messages.filter(m => m.toolName).map(m => ({ toolName: m.toolName, timestamp: m.timestamp, input: m.toolInput, result: m.toolResult, isError: m.isError }));
 writeFileSync(join(root, 'result.json'), JSON.stringify({ sessionId: id, started, completed: Date.now(), elapsedMs: Date.now()-started, final: manager.getSessionFinalText(id), tools }, null, 2));
 console.log('DONE', Date.now()-started, manager.getSessionFinalText(id));
} finally { await manager.flushAllSessions(); manager.cleanup(); }
process.exit(0);
