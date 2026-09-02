/**
 * Session Types
 *
 * Types for workspace-scoped sessions.
 * Sessions are stored at {workspaceRootPath}/sessions/{id}/session.jsonl
 *
 * JSONL Format:
 * - Line 1: SessionHeader (metadata + pre-computed fields for fast list loading)
 * - Lines 2+: StoredMessage (one message per line)
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import type { StoredAttachment, MessageRole, ToolStatus, AuthRequestType, AuthStatus, CredentialInputMode, StoredMessage } from '@craft-agent/core/types';

/**
 * Session fields that persist to disk.
 * Add new fields here - they automatically propagate to JSONL read/write
 * via pickSessionFields() utility.
 *
 * IMPORTANT: When adding a new field:
 * 1. Add it to this array
 * 2. Add it to SessionConfig interface below
 * 3. Done - serialization is automatic
 */
export const SESSION_PERSISTENT_FIELDS = [
  // Identity
  'id', 'workspaceRootPath', 'sdkSessionId', 'sdkCwd',
  // Timestamps
  'createdAt', 'lastUsedAt', 'lastMessageAt',
  // Display
  'name', 'isFlagged', 'sessionStatus', 'labels', 'hidden',
  // Read tracking
  'lastReadMessageId', 'hasUnread',
  // Config
  'enabledSourceSlugs', 'permissionMode', 'previousPermissionMode', 'workingDirectory',
  'sharedProjectMemoryEnabled',
  // Model/Connection
  'model', 'llmConnection', 'connectionLocked', 'thinkingLevel',
  // Sharing
  'sharedUrl', 'sharedId',
  // Plan execution
  'pendingPlanExecution',
  // Archive
  'isArchived', 'archivedAt',
  // Branching
  'branchFromMessageId',
  'branchFromSdkSessionId',
  'branchFromSessionPath',
  'branchFromSdkCwd',
  'branchFromSdkTurnId',
  // Remote transfer handoff
  'transferredSessionSummary',
  'transferredSessionSummaryApplied',
  // Automation origin
  'triggeredBy',
  // Project binding (workspace-scoped grouping)
  'projectId',
  // Kanban: task/subtask hierarchy + board column
  'parentSessionId',
  'kanbanColumn',
  // Tasks Conductor: link a session back to the task spec / run / DAG node that owns it
  'taskSlug',
  'taskRunId',
  'taskNodeId',
  'taskNodeCount',
  'taskDraft',
  // Per-session Swarm preview state and lineage
  'swarmEnabled',
  'orchestrationId',
  'orchestrationRootSessionId',
  'orchestrationDepth',
  'orchestrationRole',
  'orchestrationLifecycle',
  'orchestrationStatus',
  'orchestrationBlocker',
  'orchestrationTokensUsed',
  'orchestrationTokenBudget',
] as const;

export type SessionPersistentField = typeof SESSION_PERSISTENT_FIELDS[number];

/**
 * Session status (user-controlled, never automatic)
 *
 * Dynamic status ID referencing workspace status config.
 * Validated at runtime via validateSessionStatus().
 * Falls back to 'todo' if status doesn't exist.
 */
export type SessionStatus = string;

export interface SwarmSessionMetadata {
  /** Autonomous delegation is opt-in per session; missing legacy values resolve to false. */
  swarmEnabled?: boolean;
  orchestrationId?: string;
  orchestrationRootSessionId?: string;
  orchestrationDepth?: number;
  orchestrationRole?: 'coordinator' | 'worker' | 'reviewer';
  orchestrationLifecycle?: 'managed' | 'detached';
  orchestrationStatus?: 'running' | 'completed' | 'need-to-check' | 'stopped';
  orchestrationBlocker?: string;
  orchestrationTokensUsed?: number;
  orchestrationTokenBudget?: number;
}

/** True only for an agent spawned inside a Swarm, never for its root coordinator. */
export function isSpawnedSwarmAgent(
  session: Pick<SwarmSessionMetadata, 'orchestrationId' | 'orchestrationRootSessionId' | 'orchestrationDepth'> & { id: string },
): boolean {
  if (!session.orchestrationId) return false;
  if (session.orchestrationRootSessionId) {
    return session.orchestrationRootSessionId !== session.id;
  }
  return (session.orchestrationDepth ?? 0) > 0;
}

/**
 * Built-in status IDs (for TypeScript consumers)
 * These are the default statuses but users can add/remove custom ones
 */
export type BuiltInStatusId = 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled';

/**
 * Session token usage tracking
 */
export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Model's context window size in tokens (from SDK modelUsage) */
  contextWindow?: number;
  /** Usage reported by the most recent individual model call. Absent on legacy sessions. */
  lastCall?: SessionModelCallUsage;
  /** Live aggregate for the user task that is currently processing. Runtime-only in normal operation. */
  currentTurn?: SessionTurnUsageSnapshot;
  /** Aggregate usage for the most recently completed user turn. Absent on legacy sessions. */
  lastTurn?: SessionTurnUsage;
}

/** Provider-normalized usage for one model invocation. */
export interface SessionModelCallUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/** Provider-normalized aggregate snapshot for an in-progress user turn. */
export interface SessionTurnUsageSnapshot extends SessionModelCallUsage {
  modelCallCount: number;
  wallClockMs: number;
  startedAt: number;
  updatedAt: number;
}

/** Provider-normalized aggregate for one user turn, including orchestration overhead. */
export interface SessionTurnUsage extends SessionModelCallUsage {
  modelCallCount: number;
  wallClockMs: number;
  startedAt: number;
  completedAt: number;
}

/**
 * Stored message format (simplified for persistence)
 * Re-exported from @craft-agent/core for convenience
 */
export type { StoredMessage } from '@craft-agent/core/types';

/**
 * Session configuration (persisted metadata)
 */
export interface SessionConfig extends SwarmSessionMetadata {
  id: string;
  /** SDK session ID (captured after first message) */
  sdkSessionId?: string;
  /** Workspace root path this session belongs to */
  workspaceRootPath: string;
  /** Optional user-defined name */
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message (user or final assistant). Used for date grouping in session list.
   *  Separate from lastUsedAt which tracks any session access (auto-save, open to read, etc.). */
  lastMessageAt?: number;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode;
  /** Previous permission mode (used to preserve modeTransition context across restarts) */
  previousPermissionMode?: PermissionMode;
  /** User-controlled session status - determines inbox vs completed */
  sessionStatus?: SessionStatus;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** ID of last message user has read */
  lastReadMessageId?: string;
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean;
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[];
  /** Working directory for this session (used by agent for bash commands and context) */
  workingDirectory?: string;
  /** SDK cwd for session storage - set once at creation, never changes. Ensures SDK can find session transcripts regardless of workingDirectory changes. */
  sdkCwd?: string;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  /** LLM connection slug for this session */
  llmConnection?: string;
  /** When true, workspace/global defaults and queued snapshots cannot retarget this session */
  connectionLocked?: boolean;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /**
   * Pending plan execution state - tracks "Accept & Compact" flow.
   * When set, indicates a plan needs to be executed after compaction completes.
   * Cleared on: successful execution, new user message, or manual clear.
   */
  pendingPlanExecution?: {
    /** Path to the plan file to execute */
    planPath: string;
    /** Optional snapshot of draft input captured at accept time */
    draftInputSnapshot?: string;
    /** Whether we're still waiting for compaction to complete */
    awaitingCompaction: boolean;
    /** Whether execution has already been dispatched from the UI. */
    executionDispatched?: boolean;
  };
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean;
  /** Whether this session is archived */
  isArchived?: boolean;
  /** Timestamp when session was archived (for retention policy) */
  archivedAt?: number;
  /**
   * Message ID this session was branched from.
   * Branching semantics are a hard cutoff: model context must not include parent messages after this message.
   */
  branchFromMessageId?: string;
  /**
   * Parent session's SDK session ID (optional, only for provider strategies that support strict SDK-level forking).
   */
  branchFromSdkSessionId?: string;
  /**
   * Parent session's storage path (optional, only when provider-level forking needs parent session files).
   */
  branchFromSessionPath?: string;
  /**
   * Parent session's sdkCwd (optional). SDK session files are stored per-CWD
   * (`~/.claude/projects/{cwd-hash}/`), so forking requires the child subprocess
   * to use the parent's CWD to locate the parent's session file.
   */
  branchFromSdkCwd?: string;
  /**
   * Provider-native branch anchor at the branch point.
   * - Claude: assistant message UUID (used as `resumeSessionAt`)
   * - Pi: session entry ID (used with SessionManager.branch(anchor))
   */
  branchFromSdkTurnId?: string;
  /** Force the provider to create a new native session instead of resuming recent history. */
  forceFreshSdkSession?: boolean;
  /** One-shot hidden summary injected on the first turn after a remote transfer. */
  transferredSessionSummary?: string;
  /** Whether the transferred-session summary has already been injected. */
  transferredSessionSummaryApplied?: boolean;
  /** Metadata for sessions created by automations */
  triggeredBy?: {
    automationName?: string;
    event?: string;
    timestamp?: number;
    sourceSessionId?: string;
    automationDepth?: number;
  };
  /** Workspace-scoped project id this session belongs to (undefined = unbound). */
  projectId?: string;
  /** When true, this session was created with shared project MEMORY.md. Runtime ignores it. */
  sharedProjectMemoryEnabled?: boolean;
  /** Parent session id — when set, this session is a subtask of the parent (undefined = top-level task). */
  parentSessionId?: string;
  /** Kanban board column id ('todo' | 'in-progress' | 'done'). Drag-to-move target; independent of sessionStatus. */
  kanbanColumn?: string;
  /** Tasks Conductor: slug of the task spec this session belongs to (orchestrator + child nodes). */
  taskSlug?: string;
  /** Tasks Conductor: id of the run that spawned this child session (child nodes only). */
  taskRunId?: string;
  /** Tasks Conductor: id of the DAG node this child session executes (child nodes only). */
  taskNodeId?: string;
  /** Tasks Conductor: total DAG node count (orchestrator only) — board progress denominator that stays stable while children spawn lazily. */
  taskNodeCount?: number;
  /** Tasks Conductor: generate-time draft orchestrator. Hidden from the board until adopted (promoted) by createTask. */
  taskDraft?: boolean;
}

/**
 * Stored session with conversation data
 */
export interface StoredSession extends SessionConfig {
  messages: StoredMessage[];
  tokenUsage: SessionTokenUsage;
}

/**
 * Session header - line 1 of session.jsonl
 *
 * Contains all metadata needed for list views (pre-computed at save time).
 * This enables fast session listing without parsing message content.
 */
export interface SessionHeader extends SwarmSessionMetadata {
  id: string;
  /** SDK session ID (captured after first message) */
  sdkSessionId?: string;
  /** Workspace root path (stored as portable path, e.g., ~/.craft-agent/...) */
  workspaceRootPath: string;
  /** Optional user-defined name */
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message — persisted separately from lastUsedAt for stable date grouping across restarts. */
  lastMessageAt?: number;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode;
  /** Previous permission mode (used to preserve modeTransition context across restarts) */
  previousPermissionMode?: PermissionMode;
  /** User-controlled session status - determines inbox vs completed */
  sessionStatus?: SessionStatus;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** ID of last message user has read */
  lastReadMessageId?: string;
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean;
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[];
  /** Working directory for this session (used by agent for bash commands and context) */
  workingDirectory?: string;
  /** SDK cwd for session storage - set once at creation, never changes */
  sdkCwd?: string;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  /** LLM connection slug for this session */
  llmConnection?: string;
  /** When true, workspace/global defaults and queued snapshots cannot retarget this session */
  connectionLocked?: boolean;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /**
   * Pending plan execution state - tracks "Accept & Compact" flow.
   * When set, indicates a plan needs to be executed after compaction completes.
   * Cleared on: successful execution, new user message, or manual clear.
   */
  pendingPlanExecution?: {
    /** Path to the plan file to execute */
    planPath: string;
    /** Optional snapshot of draft input captured at accept time */
    draftInputSnapshot?: string;
    /** Whether we're still waiting for compaction to complete */
    awaitingCompaction: boolean;
    /** Whether execution has already been dispatched from the UI. */
    executionDispatched?: boolean;
  };
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean;
  /** Whether this session is archived */
  isArchived?: boolean;
  /** Timestamp when session was archived (for retention policy) */
  archivedAt?: number;
  /** One-shot hidden summary injected on the first turn after a remote transfer. */
  transferredSessionSummary?: string;
  /** Whether the transferred-session summary has already been injected. */
  transferredSessionSummaryApplied?: boolean;
  /** Metadata for sessions created by automations */
  triggeredBy?: {
    automationName?: string;
    event?: string;
    timestamp?: number;
    sourceSessionId?: string;
    automationDepth?: number;
  };
  /** Workspace-scoped project id this session belongs to (undefined = unbound). */
  projectId?: string;
  /** Persisted snapshot only; runtime no longer shares project MEMORY.md. */
  sharedProjectMemoryEnabled?: boolean;
  /** Parent session id — when set, this session is a subtask of the parent (undefined = top-level task). */
  parentSessionId?: string;
  /** Kanban board column id ('todo' | 'in-progress' | 'done'). Drag-to-move target; independent of sessionStatus. */
  kanbanColumn?: string;
  /** Tasks Conductor: slug of the task spec this session belongs to (orchestrator + child nodes). */
  taskSlug?: string;
  /** Tasks Conductor: id of the run that spawned this child session (child nodes only). */
  taskRunId?: string;
  /** Tasks Conductor: id of the DAG node this child session executes (child nodes only). */
  taskNodeId?: string;
  /** Tasks Conductor: total DAG node count (orchestrator only) — board progress denominator that stays stable while children spawn lazily. */
  taskNodeCount?: number;
  /** Tasks Conductor: generate-time draft orchestrator. Hidden from the board until adopted (promoted) by createTask. */
  taskDraft?: boolean;
  // Pre-computed fields for fast list loading
  /** Number of messages in session */
  messageCount: number;
  /** Role/type of the last message (for badge display without loading messages) */
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  /** Preview of first user message (first 150 chars) */
  preview?: string;
  /** Token usage statistics */
  tokenUsage: SessionTokenUsage;
  /** ID of the last final (non-intermediate) assistant message - for unread detection without loading messages */
  lastFinalMessageId?: string;
}

/**
 * Session metadata (lightweight, for lists)
 */
export interface SessionMetadata extends SwarmSessionMetadata {
  id: string;
  workspaceRootPath: string;
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message — used for date grouping. Falls back to lastUsedAt for pre-fix sessions. */
  lastMessageAt?: number;
  messageCount: number;
  /** Preview of first user message */
  preview?: string;
  sdkSessionId?: string;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** User-controlled session status */
  sessionStatus?: SessionStatus;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** Explicit per-session source selection (absent = follow workspace defaults) */
  enabledSourceSlugs?: string[];
  /** Permission mode for this session */
  permissionMode?: PermissionMode;
  /** Previous permission mode (used to preserve modeTransition context across restarts) */
  previousPermissionMode?: PermissionMode;
  /** Number of plan files for this session */
  planCount?: number;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Working directory for this session */
  workingDirectory?: string;
  /** SDK cwd for session storage - set once at creation, never changes */
  sdkCwd?: string;
  /** Role/type of the last message (for badge display without loading messages) */
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  /** LLM connection slug for this session */
  llmConnection?: string;
  /** When true, workspace/global defaults and queued snapshots cannot retarget this session */
  connectionLocked?: boolean;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /** ID of last message user has read - for unread detection */
  lastReadMessageId?: string;
  /** ID of the last final (non-intermediate) assistant message - for unread detection */
  lastFinalMessageId?: string;
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean;
  /** Token usage statistics (from JSONL header, available without loading messages) */
  tokenUsage?: SessionTokenUsage;
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean;
  /** Whether this session is archived */
  isArchived?: boolean;
  /** Timestamp when session was archived (for retention policy) */
  archivedAt?: number;
  /** Message ID that this session was branched from (hard context cutoff marker). */
  branchFromMessageId?: string;
  /** Workspace-scoped project id this session belongs to (undefined = unbound). */
  projectId?: string;
  /** Persisted snapshot only; runtime no longer shares project MEMORY.md. */
  sharedProjectMemoryEnabled?: boolean;
  /** Parent session id — when set, this session is a subtask of the parent (undefined = top-level task). */
  parentSessionId?: string;
  /** Kanban board column id ('todo' | 'in-progress' | 'done'). Drag-to-move target; independent of sessionStatus. */
  kanbanColumn?: string;
  /** Tasks Conductor: slug of the task spec this session belongs to (orchestrator + child nodes). */
  taskSlug?: string;
  /** Tasks Conductor: id of the run that spawned this child session (child nodes only). */
  taskRunId?: string;
  /** Tasks Conductor: id of the DAG node this child session executes (child nodes only). */
  taskNodeId?: string;
  /** Tasks Conductor: total DAG node count (orchestrator only) — board progress denominator that stays stable while children spawn lazily. */
  taskNodeCount?: number;
  /** Tasks Conductor: generate-time draft orchestrator. Hidden from the board until adopted (promoted) by createTask. */
  taskDraft?: boolean;
}

/** Project sessions use independent memory; shared MEMORY.md is retired. */
export function isSharedProjectMemoryEnabled(
  _session?: Pick<SessionConfig, 'sharedProjectMemoryEnabled'> | null,
): boolean {
  return false;
}
