import { createHash } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, sep, isAbsolute } from 'node:path';
import { loadProjectById } from '@craft-agent/shared/projects';
import { readSessionHeader, readSessionJsonl, type StoredSession } from '@craft-agent/shared/sessions';
import type { ProjectHistoryInput } from '@craft-agent/session-tools-core';
import { redactHandoverText } from './handover-snapshot';

/** Rebuilt from canonical logs on every request: changes/deletions/revoked authorization take effect immediately. */
export function projectHistory(root: string, requester: Pick<StoredSession, 'id' | 'projectId' | 'workMode' | 'workModeNeedsReview' | 'executionRootSessionId' | 'parentSessionId' | 'taskRunId'>, input: ProjectHistoryInput): unknown {
  if (requester.workMode !== 'PRO' || requester.workModeNeedsReview || !requester.projectId) throw new Error('Project history requires an authorized PRO project conversation.');
  const project = loadProjectById(root, requester.projectId);
  if (!project?.config.historySearchEnabled) throw new Error('Project history search is disabled. The user can enable it in project settings.');
  const sessionsRoot = join(realpathSync(root), 'sessions');
  const files = new Map<string, string>();
  const headers = existsSync(sessionsRoot) ? readdirSync(sessionsRoot, { withFileTypes: true }).flatMap(dir => {
    if (!dir.isDirectory()) return [];
    const path = join(sessionsRoot, dir.name, 'session.jsonl');
    try {
      const rel = relative(sessionsRoot, realpathSync(path));
      if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return [];
      const header = readSessionHeader(path);
      if (!header || header.id !== dir.name) return [];
      files.set(header.id, path); return [header];
    } catch { return []; }
  }) : [];
  const eligible = headers.filter(session => session.projectId === requester.projectId && !session.hidden
    && (session.id === requester.id || (session.executionRootSessionId ?? session.id) !== (requester.executionRootSessionId ?? requester.id)));
  const safeMessage = (session: StoredSession, message: StoredSession['messages'][number]) => {
    if (!['user', 'assistant'].includes(message.type) || message.isIntermediate || !message.content.trim()) return undefined;
    // Hash the original fields exposed by expansion in a fixed order. Session
    // persistence may reorder JSON keys without changing the original message.
    const version = createHash('sha256').update(JSON.stringify({ id: message.id, type: message.type,
      timestamp: message.timestamp, content: message.content })).digest('hex');
    return { sessionId: session.id, messageId: message.id, version, role: message.type,
      text: redactHandoverText(message.content), parentSessionId: session.parentSessionId, timestamp: message.timestamp };
  };
  if (input.sessionId || input.messageId) {
    if (!input.sessionId || !input.messageId || !input.expectedVersion) throw new Error('Expansion requires sessionId, messageId and expectedVersion from a search hit.');
    const header = eligible.find(session => session.id === input.sessionId);
    if (!header) throw new Error('Session is outside the authorized project or shares a sibling execution context.');
    const session = readSessionJsonl(files.get(header.id)!); const message = session?.messages.find(message => message.id === input.messageId);
    const value = session && message ? safeMessage(session, message) : undefined;
    if (!value || value.version !== input.expectedVersion) throw new Error('Original history was changed/deleted or is unavailable; search again.');
    const offset = input.offset ?? 0, end = Math.min(offset + 8000, value.text.length);
    return { ...value, text: value.text.slice(offset, end), nextOffset: end < value.text.length ? end : null, verifiedEvidence: false,
      note: 'Conversation data, not a source read, current instructions or independent verification. Images/attachments and credentials are excluded.' };
  }
  const query = input.query?.trim().toLowerCase(); if (!query) throw new Error('A specific search query is required; project history is never automatic context.');
  const matches = eligible.flatMap(header => {
    const session = readSessionJsonl(files.get(header.id)!); if (!session) return [];
    return session.messages.flatMap(message => { const value = safeMessage(session, message);
      if (!value || !value.text.toLowerCase().includes(query)) return [];
      const start = Math.max(0, value.text.toLowerCase().indexOf(query) - 100);
      return [{ sessionId: value.sessionId, messageId: value.messageId, version: value.version, role: value.role,
        parentSessionId: value.parentSessionId, timestamp: value.timestamp, excerpt: value.text.slice(start, start + 400) }]; });
  }).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const offset = input.offset ?? 0;
  return { projectId: requester.projectId, total: matches.length, hits: matches.slice(offset, offset + 12), nextOffset: offset + 12 < matches.length ? offset + 12 : null,
    verifiedEvidence: false, note: 'Expand exact message/version when needed. Summaries and previous answers are not frozen source evidence. No automatic memory injection.' };
}
