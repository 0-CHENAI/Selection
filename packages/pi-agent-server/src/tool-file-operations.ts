import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { closeSync, constants, fsyncSync, openSync, readFileSync } from 'node:fs';
import { isNativeReadOnlyTool, PI_TOOL_NAME_MAP } from '../../shared/src/agent/backend/pi/constants';
import { access, mkdir, readFile } from 'node:fs/promises';
import { INTERRUPTED_READ_RESULT, recoveredFileOperationText, readToolFileOperation, verifyToolFileOperation, writeFileWithReceipt, type ToolFileOperationIdentity } from '../../shared/src/agent/backend/pi/file-operation-receipts';

const operations = new AsyncLocalStorage<{ sessionPath: string; identity: ToolFileOperationIdentity }>();
export function withToolFileOperation<T>(sessionPath: string, identity: ToolFileOperationIdentity, execute: () => Promise<T>): Promise<T> {
  return operations.run({ sessionPath, identity }, execute);
}
const writeFile = async (path: string, content: string) => {
  const operation = operations.getStore();
  if (!operation) throw new Error('Native file operation has no execution identity');
  await writeFileWithReceipt(operation.sessionPath, operation.identity, path, content);
};
export const nativeWriteOperations = { writeFile, mkdir: async (path: string) => { await mkdir(path, { recursive: true }); } };
export const nativeEditOperations = { writeFile, readFile, access: async (path: string) => { await access(path, constants.R_OK | constants.W_OK); } };

/** Close saved call/result pairs using trusted receipts before the SDK sends a prompt. */
export function restoreToolResults(manager: import('@earendil-works/pi-coding-agent').SessionManager, sessionPath: string,
  plan: import('../../shared/src/agent/backend/pi/file-operation-receipts').ToolResultRecoveryPlan): void {
  const file = manager.getSessionFile();
  if (!file || manager.getSessionId() !== plan.sdkSessionId || !plan.sessionId
    || createHash('sha256').update(readFileSync(file)).digest('hex') !== plan.sdkStateHash) throw new Error('SDK state changed before tool recovery');
  const messages = manager.getBranch().filter(entry => entry.type === 'message').map(entry => entry.message);
  const recovered: import('@earendil-works/pi-ai').ToolResultMessage[] = [];
  for (const [toolCallId, pending] of Object.entries(plan.pendingTools)) {
    let callIndex = -1;
    for (let index = messages.length - 1; index >= 0; index--) {
      const candidate = messages[index];
      if (candidate?.role === 'assistant' && candidate.content.some(part => part.type === 'toolCall' && part.id === toolCallId)) {
        callIndex = index; break;
      }
    }
    const message = messages[callIndex];
    const calls = message?.role === 'assistant' ? message.content.filter(part => part.type === 'toolCall' && part.id === toolCallId) : [];
    const call = calls[0];
    if (calls.length !== 1 || !call || call.type !== 'toolCall'
      || (PI_TOOL_NAME_MAP[call.name] ?? call.name) !== (PI_TOOL_NAME_MAP[pending.name] ?? pending.name)) throw new Error('Saved tool call does not match recovery identity');
    const existing = messages.slice(callIndex + 1).filter(message => message.role === 'toolResult' && message.toolCallId === toolCallId);
    if (existing.length > 1) throw new Error('Duplicate saved tool result');
    if (existing.some(result => result.role === 'toolResult'
      && (PI_TOOL_NAME_MAP[result.toolName] ?? result.toolName) !== (PI_TOOL_NAME_MAP[call.name] ?? call.name))) {
      throw new Error('Saved tool result does not match recovery identity');
    }
    const nativeWrite = pending.recovery === 'file-verifiable' && (pending.name === 'Write' || pending.name === 'Edit');
    let text: string;
    if (nativeWrite) {
      const identity = { sessionId: plan.sessionId, sdkSessionId: plan.sdkSessionId, answerRunId: plan.answerRunId,
        toolCallId, toolName: pending.name as 'Write' | 'Edit' };
      const receipt = readToolFileOperation(sessionPath, identity);
      if (!receipt || !verifyToolFileOperation(receipt, identity)) throw new Error('File operation outcome could not be verified');
      text = recoveredFileOperationText(receipt);
    } else if (pending.recovery === 'read-only' && isNativeReadOnlyTool(pending.name)) {
      text = INTERRUPTED_READ_RESULT;
    } else if (!existing.length) throw new Error('Tool operation outcome is unknown; automatic replay is blocked');
    else text = '';
    if (!existing.length) recovered.push({ role: 'toolResult', toolCallId, toolName: call.name,
      content: [{ type: 'text', text }], isError: !nativeWrite, timestamp: Date.now() });
  }
  // Validate every outcome before appending any result. Use the SDK's own entry/branch writer.
  for (const result of recovered) manager.appendMessage(result);
  const fd = openSync(file, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
