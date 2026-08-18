/**
 * Session-Scoped Tools
 *
 * Callback registry and plan-file helpers shared by Pi sessions.
 * Tool definitions and handlers live in @craft-agent/session-tools-core.
 */

import { getSessionPlansPath } from '../sessions/storage.ts';

export type {
  CredentialInputMode,
  AuthRequestType,
  AuthRequest,
  AuthResult,
  CredentialAuthRequest,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  GoogleService,
  SlackService,
  MicrosoftService,
} from '@craft-agent/session-tools-core';

export type { BrowserPaneFns } from './browser-tools.ts';

export {
  type SessionScopedToolCallbacks,
  registerSessionScopedToolCallbacks,
  mergeSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  getSessionScopedToolCallbacks,
} from './session-scoped-tool-callback-registry.ts';

const sessionPlanFilePaths = new Map<string, string>();

export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFilePaths.get(sessionId) ?? null;
}

export function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFilePaths.set(sessionId, path);
}

export function clearPlanFileState(sessionId: string): void {
  sessionPlanFilePaths.delete(sessionId);
}

export function getSessionPlansDir(workspacePath: string, sessionId: string): string {
  return getSessionPlansPath(workspacePath, sessionId);
}

export function isPathInPlansDir(path: string, workspacePath: string, sessionId: string): boolean {
  const plansDir = getSessionPlansDir(workspacePath, sessionId);
  return path.startsWith(plansDir);
}

export function invalidateAllSessionToolsCaches(): void {
  // Pi registers tools per subprocess; nothing to cache here after the Claude adapter was removed.
}

export function cleanupSessionScopedTools(sessionId: string): void {
  clearPlanFileState(sessionId);
}
