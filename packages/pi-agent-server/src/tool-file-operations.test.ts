import { afterEach, expect, test } from 'bun:test';
import { createEditToolDefinition, createWriteToolDefinition } from '@earendil-works/pi-coding-agent';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileFingerprint, readToolFileOperation, verifyToolFileOperation, writeFileWithReceipt, type ToolFileOperationIdentity } from '../../shared/src/agent/backend/pi/file-operation-receipts';
import { nativeEditOperations, nativeWriteOperations, withToolFileOperation } from './tool-file-operations';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(toolName: 'Write' | 'Edit' = 'Write') {
  const root = mkdtempSync(join(tmpdir(), 'selection-native-file-operation-')); roots.push(root);
  const identity: ToolFileOperationIdentity = { sessionId: 'session', sdkSessionId: 'sdk', answerRunId: 'run', toolCallId: 'call', toolName };
  return { root, identity };
}
test('native Write records exact resolved paths and bytes without changing its tool arguments or output', async () => {
  const { root, identity } = fixture();
  const tool = createWriteToolDefinition(root, { operations: nativeWriteOperations });
  const text = '# 中文 😀\r\n```ts\r\nconst x = 1\r\n```';
  const result = await withToolFileOperation(root, identity, () => tool.execute(identity.toolCallId, { path: '跨盘 文件.txt', content: text }, undefined, undefined, {} as never));
  const receipt = readToolFileOperation(root, identity)!;
  expect(result.content[0]).toMatchObject({ type: 'text' });
  expect(readFileSync(join(root, '跨盘 文件.txt'), 'utf8')).toBe(text);
  expect(receipt).toMatchObject({ ...identity, path: join(root, '跨盘 文件.txt'), state: 'written', expected: fileFingerprint(join(root, '跨盘 文件.txt')) });
  expect(verifyToolFileOperation(receipt, identity)).toBe(true);
  expect(JSON.stringify(receipt)).not.toContain('const x');
});
test('native Edit preserves SDK BOM and CRLF handling and journals the final computed content', async () => {
  const { root, identity } = fixture('Edit');
  const file = join(root, 'code.ts'); writeFileSync(file, '\uFEFFconst x = 1;\r\nconst y = 2;\r\n');
  const before = fileFingerprint(file);
  const tool = createEditToolDefinition(root, { operations: nativeEditOperations });
  await withToolFileOperation(root, identity, () => tool.execute(identity.toolCallId, { path: 'code.ts', edits: [{ oldText: 'const x = 1;', newText: 'const x = 3;' }] }, undefined, undefined, {} as never));
  expect(readFileSync(file, 'utf8')).toBe('\uFEFFconst x = 3;\r\nconst y = 2;\r\n');
  const receipt = readToolFileOperation(root, identity)!;
  expect(receipt.before).toEqual(before);
  expect(receipt.expected).toEqual(fileFingerprint(file));
  expect(verifyToolFileOperation(receipt, identity)).toBe(true);
});
test('failure to save the prepared receipt prevents any native file write', async () => {
  const { root, identity } = fixture();
  writeFileSync(join(root, 'data'), 'not a directory');
  const file = join(root, 'file.txt'); writeFileSync(file, 'original');
  await expect(writeFileWithReceipt(root, identity, file, 'updated')).rejects.toThrow();
  expect(readFileSync(file, 'utf8')).toBe('original');
});
test('duplicate identities do not overwrite later edits; separate runs and concurrent calls keep their own receipts', async () => {
  const { root, identity } = fixture();
  const file = join(root, 'file.txt');
  await writeFileWithReceipt(root, identity, file, 'first');
  const receipt = readToolFileOperation(root, identity)!;
  await writeFileWithReceipt(root, identity, file, 'first');
  expect(readToolFileOperation(root, identity)).toEqual(receipt);
  await expect(writeFileWithReceipt(root, identity, file, 'other')).rejects.toThrow('different parameters');
  writeFileSync(file, 'external edit');
  expect(verifyToolFileOperation(receipt, identity)).toBe(false);
  await expect(writeFileWithReceipt(root, identity, file, 'first')).rejects.toThrow('refusing to overwrite');
  expect(readFileSync(file, 'utf8')).toBe('external edit');
  const tool = createWriteToolDefinition(root, { operations: nativeWriteOperations });
  await Promise.all(['next-run', 'third-run'].map(answerRunId => withToolFileOperation(root, { ...identity, answerRunId },
    () => tool.execute('call', { path: answerRunId, content: answerRunId }, undefined, undefined, {} as never))));
  for (const answerRunId of ['next-run', 'third-run']) expect(readToolFileOperation(root, { ...identity, answerRunId })).toMatchObject({ answerRunId, path: join(root, answerRunId) });
  expect(readdirSync(join(root, 'data', 'tool-file-operations')).filter(name => name.endsWith('.json'))).toHaveLength(3);
});
test('directory links keep content identity; moved links and invalid receipts cannot verify', async () => {
  const { root, identity } = fixture();
  const target = join(root, 'actual'); mkdirSync(target);
  const link = join(root, 'link'); symlinkSync(target, link, 'junction');
  const file = join(link, 'file.txt'); await writeFileWithReceipt(root, identity, file, 'written');
  const receipt = readToolFileOperation(root, identity)!;
  expect(receipt.canonicalPath).toBe(realpathSync(join(target, 'file.txt')));
  expect(verifyToolFileOperation(receipt, identity)).toBe(true);
  expect(verifyToolFileOperation(receipt, { ...identity, sdkSessionId: 'other' })).toBe(false);
  expect(verifyToolFileOperation({ ...receipt, hostId: 'other-host' }, identity)).toBe(false);
  rmSync(link); const other = join(root, 'other'); mkdirSync(other); writeFileSync(join(other, 'file.txt'), 'written'); symlinkSync(other, link, 'junction');
  expect(verifyToolFileOperation(receipt, identity)).toBe(false);
  const receiptFile = readdirSync(join(root, 'data', 'tool-file-operations')).find(name => name.endsWith('.json'))!;
  writeFileSync(join(root, 'data', 'tool-file-operations', receiptFile), '{"version":99}');
  expect(() => readToolFileOperation(root, identity)).toThrow('invalid');
  expect(existsSync(join(target, 'file.txt'))).toBe(true);
});

const sdkUsage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
async function savedCallFixture() {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const { root, identity } = fixture();
  const manager = SessionManager.create(root, join(root, '.pi-sessions'));
  identity.sdkSessionId = manager.getSessionId();
  manager.appendMessage({ role: 'user', content: 'Write the file', timestamp: 1 });
  manager.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: identity.toolCallId, name: 'write', arguments: { path: 'result.txt', content: 'done' } }],
    api: 'openai-responses', provider: 'openai', model: 'fixture', usage: sdkUsage, stopReason: 'toolUse', timestamp: 2 });
  const { sdkStateHash } = await import('../../server-core/src/reliability/execution-checkpoint');
  const plan = { sessionId: identity.sessionId, sdkSessionId: identity.sdkSessionId, answerRunId: identity.answerRunId,
    sdkStateHash: sdkStateHash(root, identity.sdkSessionId)!, pendingTools: { [identity.toolCallId]: { name: 'Write', recovery: 'file-verifiable' as const } } };
  return { root, identity, manager, plan, file: join(root, 'result.txt'), SessionManager, sdkStateHash };
}
test('verified writes restore exactly one SDK tool result and survive SDK reload without replay', async () => {
  const { restoreToolResults } = await import('./tool-file-operations');
  const { root, identity, manager, plan, file, SessionManager, sdkStateHash } = await savedCallFixture();
  await writeFileWithReceipt(root, identity, file, 'done');
  const receipt = readToolFileOperation(root, identity)!;
  restoreToolResults(manager, root, plan);
  const results = manager.buildSessionContext().messages.filter(message => message.role === 'toolResult');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ toolCallId: identity.toolCallId, toolName: 'write', isError: false });
  expect(JSON.stringify(results[0])).toContain('Do not replay this write');
  const reloaded = SessionManager.open(manager.getSessionFile()!);
  restoreToolResults(reloaded, root, { ...plan, sdkStateHash: sdkStateHash(root, identity.sdkSessionId)! });
  expect(reloaded.buildSessionContext().messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
  expect(readToolFileOperation(root, identity)).toEqual(receipt);
  expect(readFileSync(file, 'utf8')).toBe('done');
});
test('recovery validates the whole batch and source snapshot before appending any result', async () => {
  const { restoreToolResults } = await import('./tool-file-operations');
  const { root, identity, manager, plan, file, sdkStateHash } = await savedCallFixture();
  await writeFileWithReceipt(root, identity, file, 'done');
  writeFileSync(file, 'external edit');
  expect(() => restoreToolResults(manager, root, plan)).toThrow('could not be verified');
  expect(manager.buildSessionContext().messages.filter(message => message.role === 'toolResult')).toHaveLength(0);
  writeFileSync(file, 'done');
  manager.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'unknown', name: 'bash', arguments: { command: 'external action' } }],
    api: 'openai-responses', provider: 'openai', model: 'fixture', usage: sdkUsage, stopReason: 'toolUse', timestamp: 3 });
  expect(() => restoreToolResults(manager, root, plan)).toThrow('SDK state changed');
  const current = { ...plan, sdkStateHash: sdkStateHash(root, identity.sdkSessionId)!, pendingTools: {
    ...plan.pendingTools, unknown: { name: 'Bash', recovery: 'unknown' as const },
  } };
  expect(() => restoreToolResults(manager, root, current)).toThrow('automatic replay is blocked');
  expect(manager.buildSessionContext().messages.filter(message => message.role === 'toolResult')).toHaveLength(0);
});
test('a killed native writer after file fsync but before receipt publication is verified without rewriting', async () => {
  const { restoreToolResults } = await import('./tool-file-operations');
  const { root, identity, manager, plan, file } = await savedCallFixture();
  const module = new URL('../../shared/src/agent/backend/pi/file-operation-receipts.ts', import.meta.url).pathname;
  const script = `import * as fs from 'node:fs'; import { spyOn } from 'bun:test';
    const rename = fs.renameSync; let saves = 0;
    spyOn(fs, 'renameSync').mockImplementation((...args) => { if (++saves === 2) process.kill(process.pid, 'SIGKILL'); return rename(...args) });
    const { writeFileWithReceipt } = await import(${JSON.stringify(module)});
    await writeFileWithReceipt(${JSON.stringify(root)}, ${JSON.stringify(identity)}, ${JSON.stringify(file)}, 'done');`;
  const writer = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  expect(await writer.exited).not.toBe(0);
  expect(readToolFileOperation(root, identity)?.state).toBe('prepared');
  expect(readFileSync(file, 'utf8')).toBe('done');
  restoreToolResults(manager, root, plan);
  expect(manager.buildSessionContext().messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
  expect(readToolFileOperation(root, identity)?.state).toBe('prepared');
});

test('a prepared receipt cannot recover while its writer is alive even if the expected bytes already exist', async () => {
  const { root, identity } = fixture();
  const file = join(root, 'pending.txt');
  const module = new URL('../../shared/src/agent/backend/pi/file-operation-receipts.ts', import.meta.url).pathname;
  const script = `import * as fs from 'node:fs'; import { spyOn } from 'bun:test';
    const rename = fs.renameSync; let saves = 0;
    spyOn(fs, 'renameSync').mockImplementation((...args) => {
      if (++saves === 2) { console.log('ready'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
      return rename(...args);
    });
    const { writeFileWithReceipt } = await import(${JSON.stringify(module)});
    await writeFileWithReceipt(${JSON.stringify(root)}, ${JSON.stringify(identity)}, ${JSON.stringify(file)}, 'done');`;
  const writer = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  try {
    const reader = writer.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
    reader.releaseLock();
    const receipt = readToolFileOperation(root, identity)!;
    expect(receipt.state).toBe('prepared');
    expect(readFileSync(file, 'utf8')).toBe('done');
    expect(verifyToolFileOperation(receipt, identity)).toBe(false);
    await expect(writeFileWithReceipt(root, identity, file, 'done')).rejects.toThrow('still active');
    writer.kill('SIGKILL'); await writer.exited;
    expect(verifyToolFileOperation(receipt, identity)).toBe(true);
    await writeFileWithReceipt(root, identity, file, 'done');
    expect(readToolFileOperation(root, identity)).toEqual(receipt);
  } finally { writer.kill('SIGKILL'); await writer.exited; }
}, 10000);

test('duplicate concurrent calls cannot move the same operation identity to another target', async () => {
  const { root, identity } = fixture();
  const first = writeFileWithReceipt(root, identity, join(root, 'first.txt'), 'first');
  await expect(writeFileWithReceipt(root, identity, join(root, 'second.txt'), 'second')).rejects.toThrow('already active');
  await first;
  expect(existsSync(join(root, 'second.txt'))).toBe(false);
  expect(readToolFileOperation(root, identity)?.path).toBe(join(root, 'first.txt'));
});

test('native writes through a file link with a missing target keep the resolved content identity', async () => {
  const { root, identity } = fixture();
  const target = join(root, 'target.txt'), link = join(root, 'link.txt');
  symlinkSync('target.txt', link, 'file');
  await writeFileWithReceipt(root, identity, link, 'created target');
  expect(readFileSync(target, 'utf8')).toBe('created target');
  const receipt = readToolFileOperation(root, identity)!;
  expect(receipt.canonicalPath).toBe(realpathSync(target));
  expect(verifyToolFileOperation(receipt, identity)).toBe(true);
});

test('reused call IDs bind to the latest SDK call and mismatched saved result names are rejected', async () => {
  const { restoreToolResults } = await import('./tool-file-operations');
  const { root, identity, manager, plan, file, sdkStateHash } = await savedCallFixture();
  manager.appendMessage({ role: 'toolResult', toolCallId: identity.toolCallId, toolName: 'write', content: [{ type: 'text', text: 'previous run' }], isError: false, timestamp: 3 });
  manager.appendMessage({ role: 'user', content: 'write again', timestamp: 4 });
  manager.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: identity.toolCallId, name: 'write', arguments: { path: 'result.txt', content: 'done' } }],
    api: 'openai-responses', provider: 'openai', model: 'fixture', usage: sdkUsage, stopReason: 'toolUse', timestamp: 5 });
  await writeFileWithReceipt(root, identity, file, 'done');
  restoreToolResults(manager, root, { ...plan, sdkStateHash: sdkStateHash(root, identity.sdkSessionId)! });
  expect(manager.buildSessionContext().messages.filter(message => message.role === 'toolResult')).toHaveLength(2);
  const fixture = await savedCallFixture();
  await writeFileWithReceipt(fixture.root, fixture.identity, fixture.file, 'done');
  fixture.manager.appendMessage({ role: 'toolResult', toolCallId: fixture.identity.toolCallId, toolName: 'read', content: [{ type: 'text', text: 'mismatched result' }], isError: false, timestamp: 3 });
  expect(() => restoreToolResults(fixture.manager, fixture.root, { ...fixture.plan, sdkStateHash: fixture.sdkStateHash(fixture.root, fixture.identity.sdkSessionId)! })).toThrow('result does not match');
  expect(fixture.manager.buildSessionContext().messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
});
