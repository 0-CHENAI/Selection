/** Real, sequential Selection trials. Freeze assets before running each phase. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { getWorkspaces } from '@craft-agent/shared/config';
import { setBundledAssetsRoot } from '@craft-agent/shared/utils';
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions';
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime';
const phase = process.env.WORD_PHASE!;
const assets = process.env.WORD_ASSETS!;
const fixture = process.env.WORD_FIXTURE!;
const output = process.env.WORD_RESULTS!;
if (!phase || !assets || !fixture || !output) throw new Error('WORD_PHASE, WORD_ASSETS, WORD_FIXTURE, WORD_RESULTS required');
mkdirSync(output, { recursive: true });
setBundledAssetsRoot(resolve(assets));
setSessionPlatform(createHeadlessPlatform());
const manager = new SessionManager(); manager.setEventSink(() => {});
const ws = getWorkspaces().find(w => w.rootPath.endsWith('/my-workspace'))!;
const results: unknown[] = [];
let active: string | undefined;
process.on('SIGTERM', () => { if (active) void manager.cancelProcessing(active, true); });
try {
 if (process.env.WORD_WAIT_FOR) {
  while (true) {
   try { if (JSON.parse(readFileSync(process.env.WORD_WAIT_FOR, 'utf8')).length >= 3) break; } catch {}
   await Bun.sleep(3000);
  }
 }
 await manager.reinitializeAuth();
 for (let i = 1; i <= Number(process.env.WORD_TRIALS ?? 3); i++) {
  const dir = join(resolve(output), `${phase}-${i}`); mkdirSync(dir, { recursive: true });
  const cwd = realpathSync(dir); copyFileSync(fixture, join(cwd, 'source.txt'));
  const prompt = '请将工作目录 source.txt 中的完整报告制作成专业、好看的中文 Word 技术报告，保存为 report.docx。采用 style-system-design 模板，保留全部原文、标点和比较表格，不能删减或改写事实。资料已经确定，不联网调研。请生成并交付文件。';
  const session = await manager.createSession(ws.id, { name: `Word 对照 ${phase} ${i}`, hidden: true, swarmEnabled: false, workMode: 'PRO', permissionMode: 'allow-all', thinkingLevel: 'max', workingDirectory: cwd, model: 'Laufry', llmConnection: 'pi-api-key' });
  active = session.id; const started = Date.now();
  console.log('TRIAL_START', phase, i, active);
  const timer = setTimeout(() => { void manager.cancelProcessing(session.id, true); }, 15 * 60_000);
  let error: string | undefined;
  try { await manager.sendMessage(session.id, prompt); } catch (e) { error = String(e); }
  clearTimeout(timer); await manager.flushAllSessions();
  const actual = await manager.getSession(session.id);
  const record = { phase, trial: i, sessionId: session.id, prompt, model: 'Laufry', thinkingLevel: 'max', fixtureSha256: createHash('sha256').update(readFileSync(fixture)).digest('hex'), assets: resolve(assets), started, completed: Date.now(), elapsedMs: Date.now()-started, error, final: manager.getSessionFinalText(session.id), tools: actual?.messages.filter(m => m.toolName).map(m => ({ name: m.toolName, at: m.timestamp, input: m.toolInput, result: m.toolResult, isError: m.isError })) };
  writeFileSync(join(cwd, 'measurement.json'), JSON.stringify(record, null, 2)); results.push(record);
  writeFileSync(join(output, `${phase}.json`), JSON.stringify(results, null, 2));
  console.log('TRIAL_DONE', phase, i, record.elapsedMs, record.tools?.length, error ?? 'ok'); active = undefined;
 }
} finally { await manager.flushAllSessions(); manager.cleanup(); }
process.exit(0);
