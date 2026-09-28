import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';

export function userSourceMetadata(text: string, offset?: number) {
  return Number.isInteger(offset) && offset! >= 0 && offset! <= text.length
    ? { hash: createHash('sha256').update(text).digest('hex'), offset: offset! } : undefined;
}

export function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text').map(part => part.text).join('\n');
}

/** Only the active branch is visible: edited/regenerated sibling turns must not leak. */
export interface HistoryRecord { id: string; role: string; text: string; userText?: string; toolCallId?: string }
export function historyRecords(entries: SessionEntry[]): HistoryRecord[] {
  const offsets = new Map<string, number>();
  const committed = committedTaskSnapshots(entries);
  return entries.flatMap<HistoryRecord>(entry => {
    if (entry.type === 'custom' && entry.customType === 'selection-user-source-v1') {
      const data = entry.data as { hash?: unknown; offset?: unknown } | undefined;
      if (typeof data?.hash === 'string' && typeof data.offset === 'number' && Number.isInteger(data.offset) && data.offset >= 0) offsets.set(data.hash, data.offset);
      return [];
    }
    if (entry.type === 'custom' && committed.has(entry.id)) {
      return [{ id: entry.id, role: 'taskNotes', text: JSON.stringify(entry.data), toolCallId: undefined }];
    }
    if (entry.type !== 'message' || !('content' in entry.message)) return [];
    const message = entry.message;
    const text = textContent(message.content);
    let userText: string | undefined;
    if (message.role === 'user' && offsets.size) {
      const hash = createHash('sha256').update(text).digest('hex');
      const offset = offsets.get(hash);
      offsets.delete(hash);
      if (offset !== undefined && offset <= text.length) userText = text.slice(offset);
    }
    const calls = message.role === 'assistant' ? message.content.filter(part => part.type === 'toolCall') : [];
    return [{ id: entry.id, role: message.role, userText,
      text: [text, calls.length ? JSON.stringify(calls) : ''].filter(Boolean).join('\n'),
      toolCallId: message.role === 'toolResult' ? message.toolCallId : undefined }];
  });
}

export const STAGED_TASK_CONTEXT_TYPE = 'selection-task-context-pending-v1';
export const taskContextReference = (id: string) => `<task-context-ref>${id}</task-context-ref>`;

/** A staged snapshot becomes visible only with the checkpoint that commits it. */
export function committedTaskSnapshots(entries: SessionEntry[]) {
  const committed = new Map<string, Extract<SessionEntry, { type: 'custom' }>>();
  const staged = new Map<string, Extract<SessionEntry, { type: 'custom' }>>();
  for (const entry of entries) {
    if (entry.type === 'custom') {
      if (entry.customType === 'selection-task-context-v1') committed.set(entry.id, entry);
      if (entry.customType === STAGED_TASK_CONTEXT_TYPE) staged.set(entry.id, entry);
    } else if (entry.type === 'compaction') {
      for (const match of entry.summary.matchAll(/<task-context-ref>([^<>]+)<\/task-context-ref>/g)) {
        const snapshot = staged.get(match[1]!);
        if (snapshot) committed.set(snapshot.id, snapshot);
      }
      staged.clear();
    }
  }
  return committed;
}
