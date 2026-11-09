import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileFingerprint, type FileFingerprint } from '../../../utils/files.ts';

export interface ToolFileOperationIdentity {
  sessionId: string;
  sdkSessionId: string;
  answerRunId?: string;
  toolCallId: string;
  toolName: 'Write' | 'Edit';
}
export interface ToolResultRecoveryPlan {
  sessionId: string;
  sdkSessionId: string;
  sdkStateHash: string;
  answerRunId?: string;
  pendingTools: Record<string, { name: string; recovery: 'read-only' | 'idempotent' | 'file-verifiable' | 'unknown' }>;
}
export { fileFingerprint, type FileFingerprint } from '../../../utils/files.ts';
export interface ToolFileOperationReceipt extends ToolFileOperationIdentity {
  version: 1;
  hostId: string;
  writerPid: number;
  path: string;
  canonicalPath: string;
  before?: FileFingerprint;
  expected: FileFingerprint;
  state: 'prepared' | 'written';
  createdAt: number;
}
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const isFingerprint = (value: unknown): value is FileFingerprint => !!value && typeof value === 'object'
  && /^[a-f0-9]{64}$/.test((value as FileFingerprint).hash)
  && Number.isSafeInteger((value as FileFingerprint).size) && (value as FileFingerprint).size >= 0;
const receiptPath = (sessionPath: string, identity: ToolFileOperationIdentity) => join(sessionPath, 'data', 'tool-file-operations', `${sha256(JSON.stringify([identity.sdkSessionId, identity.answerRunId ?? null, identity.toolCallId]))}.json`);


function canonicalPath(path: string, seen = new Set<string>()): string {
  if (existsSync(path)) return realpathSync(path);
  if (seen.has(path)) throw new Error('File operation target contains a symbolic link cycle');
  seen.add(path);
  let link: string;
  try { link = readlinkSync(path); }
  catch (error) {
    if (!['ENOENT', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    return join(realpathSync(dirname(path)), basename(path));
  }
  return canonicalPath(resolve(dirname(path), link), seen);
}
export function readToolFileOperation(sessionPath: string, identity: ToolFileOperationIdentity): ToolFileOperationReceipt | undefined {
  const path = receiptPath(sessionPath, identity);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8')) as ToolFileOperationReceipt;
  if (value?.version !== 1 || value.toolCallId !== identity.toolCallId || !value.sessionId || !value.sdkSessionId
    || typeof value.sessionId !== 'string' || typeof value.sdkSessionId !== 'string'
    || (value.answerRunId !== undefined && typeof value.answerRunId !== 'string')
    || !['Write', 'Edit'].includes(value.toolName) || typeof value.hostId !== 'string'
    || !Number.isSafeInteger(value.writerPid) || value.writerPid <= 0
    || typeof value.path !== 'string' || !isAbsolute(value.path)
    || typeof value.canonicalPath !== 'string' || !isAbsolute(value.canonicalPath)
    || !isFingerprint(value.expected) || (value.before !== undefined && !isFingerprint(value.before))
    || !['prepared', 'written'].includes(value.state) || !Number.isFinite(value.createdAt)) {
    throw new Error('File operation receipt is invalid');
  }
  return value;
}
function saveReceipt(sessionPath: string, receipt: ToolFileOperationReceipt): void {
  const path = receiptPath(sessionPath, receipt);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(receipt)); fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
function writerIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
/** A prepared receipt from a live writer does not establish a settled operation. */
export function verifyToolFileOperation(receipt: ToolFileOperationReceipt, identity: ToolFileOperationIdentity): boolean {
  return !(receipt.state === 'prepared' && writerIsAlive(receipt.writerPid)) && matchesFileOperation(receipt, identity);
}
/** Check bytes and location, never infer completion from a tool's display text. */
function matchesFileOperation(receipt: ToolFileOperationReceipt, identity: ToolFileOperationIdentity): boolean {
  if (receipt.sessionId !== identity.sessionId || receipt.sdkSessionId !== identity.sdkSessionId
    || receipt.answerRunId !== identity.answerRunId || receipt.toolCallId !== identity.toolCallId
    || receipt.toolName !== identity.toolName || receipt.hostId !== hostname()) return false;
  try {
    const actual = fileFingerprint(receipt.path);
    return canonicalPath(receipt.path) === receipt.canonicalPath
      && actual?.hash === receipt.expected.hash && actual.size === receipt.expected.size;
  } catch { return false; }
}

/** Used by native SDK operations after authorization and argument normalization. */
async function executeFileWrite(sessionPath: string, identity: ToolFileOperationIdentity, path: string, content: string): Promise<void> {
  if (!isAbsolute(path) || !identity.sessionId || !identity.sdkSessionId || !identity.toolCallId) throw new Error('File operation identity is required');
  const expected = { hash: sha256(content), size: Buffer.byteLength(content, 'utf8') };
  const previous = readToolFileOperation(sessionPath, identity);
  const target = canonicalPath(path);
  if (previous) {
    if (previous.hostId !== hostname() || previous.sessionId !== identity.sessionId || previous.sdkSessionId !== identity.sdkSessionId
      || previous.answerRunId !== identity.answerRunId || previous.toolName !== identity.toolName
      || previous.path !== path || previous.canonicalPath !== target
      || previous.expected.hash !== expected.hash || previous.expected.size !== expected.size) throw new Error('File operation identity was reused with different parameters');
    if (previous.state === 'prepared' && writerIsAlive(previous.writerPid)) throw new Error('File operation writer is still active; refusing to replay');
    if (verifyToolFileOperation(previous, identity)) return;
    const actual = fileFingerprint(path);
    if (previous.state === 'written' || actual?.hash !== previous.before?.hash || actual?.size !== previous.before?.size) throw new Error('File changed after an interrupted operation; refusing to overwrite');
  }
  const receipt: ToolFileOperationReceipt = previous ? { ...previous, writerPid: process.pid } : { version: 1, ...identity, hostId: hostname(), writerPid: process.pid, path,
    canonicalPath: target, before: fileFingerprint(path), expected, state: 'prepared', createdAt: Date.now() };
  saveReceipt(sessionPath, receipt);
  const file = await open(path, 'w');
  try { await file.writeFile(content, 'utf8'); await file.sync(); }
  finally { await file.close(); }
  if (!matchesFileOperation(receipt, identity)) throw new Error('Written file could not be verified; inspect its outcome before retrying');
  saveReceipt(sessionPath, { ...receipt, state: 'written' });
}


const activeOperations = new Set<string>();
export async function writeFileWithReceipt(sessionPath: string, identity: ToolFileOperationIdentity, path: string, content: string): Promise<void> {
  const key = receiptPath(sessionPath, identity);
  if (activeOperations.has(key)) throw new Error('File operation is already active');
  activeOperations.add(key);
  try { await executeFileWrite(sessionPath, identity, path, content); }
  finally { activeOperations.delete(key); }
}


export const INTERRUPTED_READ_RESULT = 'Read-only tool result was interrupted. Query again if the task still needs this information.';
export function recoveredFileOperationText(receipt: ToolFileOperationReceipt): string {
  return `Runtime recovery verified the completed file operation at ${receipt.path} (sha256 ${receipt.expected.hash}). Do not replay this write.`;
}
