/**
 * Session Event Handlers
 *
 * Handles complete, error, sources_changed, etc.
 * Pure functions that return new state - no side effects.
 */

import type {
  SessionState,
  ProcessResult,
  CompleteEvent,
  ErrorEvent,
  TypedErrorEvent,
  SourcesChangedEvent,
  LabelsChangedEvent,
  ProjectIdChangedEvent,
  SessionStatusChangedEvent,
  SessionMetadataChangedEvent,
  SessionFlaggedEvent,
  SessionUnflaggedEvent,
  SessionArchivedEvent,
  SessionUnarchivedEvent,
  NameChangedEvent,
  PermissionRequestEvent,
  CredentialRequestEvent,
  PlanSubmittedEvent,
  StatusEvent,
  InfoEvent,
  InterruptedEvent,
  TitleGeneratedEvent,
  TitleRegeneratingEvent,
  AsyncOperationEvent,
  WorkingDirectoryChangedEvent,
  PermissionModeChangedEvent,
  SessionModelChangedEvent,
  LLMConnectionChangedEvent,
  UserMessageEvent,
  QueueChangedEvent,
  MessageAnnotationsUpdatedEvent,
  SessionSharedEvent,
  SessionUnsharedEvent,
  AuthRequestEvent,
  AuthCompletedEvent,
  UsageUpdateEvent,
  MessagesTruncatedEvent,
  MessagesRestoredEvent,
  RegenerateStartedEvent,
  Effect,
} from '../types'
import type { Message } from '../../../shared/types'
import { sessionHasLiveGeneration } from '../../lib/input-text'
import {
  generateMessageId,
  appendMessage,
  applySteerTranscriptBoundary,
  collectOpenAssistantTurnIds,
} from '../helpers'

/**
 * Handle complete - agent loop finished
 *
 * Sets isProcessing: false, clears streaming state.
 * Also marks any running tools as complete (fail-safe).
 */
export function handleComplete(
  state: SessionState,
  event: CompleteEvent
): ProcessResult {
  const { session } = state

  // Fail-safe: mark any non-terminal tools as complete.
  // Catches 'executing' (normal) and 'backgrounded' (spurious — e.g. foreground Agent
  // whose result contained agentId:). Genuinely backgrounded tasks have isBackground=true
  // AND a taskId, so they're excluded — task_completed will finalize them.
  const TERMINAL_TOOL_STATUSES = new Set(['completed', 'error'])
  let updatedMessages = session.messages
  const hasRunningTools = session.messages.some(
    m => m.role === 'tool'
      && !TERMINAL_TOOL_STATUSES.has(m.toolStatus ?? '')
      && !(m.isBackground && m.taskId)  // Don't force-complete genuine background tasks
  )

  if (hasRunningTools) {
    updatedMessages = session.messages.map(m => {
      if (
        m.role === 'tool'
        && !TERMINAL_TOOL_STATUSES.has(m.toolStatus ?? '')
        && !(m.isBackground && m.taskId)
      ) {
        return { ...m, toolStatus: 'completed' as const, toolResult: m.toolResult ?? '' }
      }
      return m
    })
  }

  // Clear isQueued from any user messages once the turn completes. Pi's steer
  // path never emits a 'processing' status update to clear it (the message is
  // injected mid-stream and absorbed into the current response), so this is
  // the natural place to drop the indicator. Claude's queued path has already
  // cleared via the 'processing' status update before this fires; this is
  // a safe no-op for that case.
  // Also drop queueId so a finished follow-up becomes a normal transcript
  // anchor for the next generation.
  const hasQueuedUserBubbles = updatedMessages.some(
    m => m.role === 'user' && (m.isQueued || m.queueId),
  )
  if (hasQueuedUserBubbles) {
    updatedMessages = updatedMessages.map(m =>
      m.role === 'user' && (m.isQueued || m.queueId)
        ? { ...m, isQueued: false, queueId: undefined }
        : m
    )
  }

  return {
    state: {
      session: {
        ...session,
        messages: updatedMessages,
        isProcessing: false,
        currentStatus: undefined,  // Clear any lingering status
        processingStartedAt: undefined,
        // Update tokenUsage from complete event (for real-time context counter updates)
        tokenUsage: event.tokenUsage ?? session.tokenUsage,
        // Update hasUnread flag from main process (state machine for NEW badge)
        // Only update if explicitly provided - undefined means "don't change"
        ...(event.hasUnread !== undefined && { hasUnread: event.hasUnread }),
        suppressedTurnIds: undefined,
      },
      streaming: null,
    },
    effects: [],
  }
}

/**
 * Handle error - simple error event
 */
export function handleError(
  state: SessionState,
  event: ErrorEvent
): ProcessResult {
  const { session } = state

  // Fail-safe: Mark any running tools as failed
  const messagesWithFailedTools = session.messages.map(m =>
    m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
      ? { ...m, toolStatus: 'error' as const, toolResult: 'Error occurred', isError: true }
      : m
  )

  const errorMessage: Message = {
    id: generateMessageId(),
    role: 'error',
    content: event.error,
    timestamp: event.timestamp ?? Date.now(),
  }

  return {
    state: {
      session: {
        ...session,
        messages: [...messagesWithFailedTools, errorMessage],
        isProcessing: false,
        currentStatus: undefined,  // Clear any lingering status
        processingStartedAt: undefined,
        suppressedTurnIds: undefined,
      },
      streaming: null,
    },
    effects: [],
  }
}

/**
 * Handle typed_error - error with structured details
 */
export function handleTypedError(
  state: SessionState,
  event: TypedErrorEvent
): ProcessResult {
  const { session } = state

  // Fail-safe: Mark any running tools as failed
  const messagesWithFailedTools = session.messages.map(m =>
    m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
      ? { ...m, toolStatus: 'error' as const, toolResult: 'Error occurred', isError: true }
      : m
  )

  const errorMessage: Message = {
    id: generateMessageId(),
    role: 'error',
    content: event.error.title
      ? `${event.error.title}: ${event.error.message}`
      : event.error.message,
    timestamp: event.timestamp ?? Date.now(),
    errorCode: event.error.code,
    errorTitle: event.error.title,
    errorDetails: event.error.details,
    errorOriginal: event.error.originalError,
    errorCanRetry: event.error.canRetry,
    errorActions: event.error.actions?.map(a => ({
      key: a.key,
      label: a.label,
      action: a.action,
      url: a.url,
      sourceSlug: a.sourceSlug,
    })),
  }

  return {
    state: {
      session: {
        ...session,
        messages: [...messagesWithFailedTools, errorMessage],
        isProcessing: false,
        currentStatus: undefined,  // Clear any lingering status
        processingStartedAt: undefined,
        suppressedTurnIds: undefined,
      },
      streaming: null,
    },
    effects: [],
  }
}

/**
 * Handle status - status message (e.g., compacting)
 * Stores on session for ProcessingIndicator AND appends as message for TurnCard activity
 */
export function handleStatus(
  state: SessionState,
  event: StatusEvent
): ProcessResult {
  const { session, streaming } = state

  const statusMessage: Message = {
    id: generateMessageId(),
    role: 'status',
    content: event.message,
    timestamp: event.timestamp ?? Date.now(),
    statusType: event.statusType,
  }

  const updatedSession = appendMessage(session, statusMessage)

  return {
    state: {
      session: {
        ...updatedSession,
        // Also store on session for ProcessingIndicator
        currentStatus: {
          message: event.message,
          statusType: event.statusType,
        },
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle info - info message (may update existing compacting message)
 */
export function handleInfo(
  state: SessionState,
  event: InfoEvent
): ProcessResult {
  const { session, streaming } = state

  // If this is a compaction complete, update the existing compacting message and clear currentStatus
  if (event.statusType === 'compaction_complete') {
    const updatedMessages = session.messages.map(m =>
      m.role === 'status' && m.statusType === 'compacting'
        ? { ...m, role: 'info' as const, content: event.message, statusType: 'compaction_complete' as const, infoLevel: event.level }
        : m
    )
    return {
      state: {
        session: {
          ...session,
          messages: updatedMessages,
          currentStatus: undefined,  // Clear status from ProcessingIndicator
        },
        streaming,
      },
      effects: [],
    }
  }

  // Otherwise, add as new info message
  const infoMessage: Message = {
    id: generateMessageId(),
    role: 'info',
    content: event.message,
    timestamp: event.timestamp ?? Date.now(),
    infoLevel: event.level,
  }

  return {
    state: {
      session: appendMessage(session, infoMessage),
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle interrupted - agent was interrupted.
 *
 * Two distinct shapes:
 * - **User-initiated stop** (`event.message` present): user clicked the Stop
 *   button. We render the "Response interrupted" notice, drop queued user
 *   bubbles, and restore their text to the input field so the user can edit
 *   and re-send.
 * - **Silent redirect** (`event.message` absent): the agent aborted internally
 *   so a new message could be processed. The backend's `processNextQueuedMessage`
 *   will auto-replay queued messages — we must NOT remove the queued bubbles
 *   nor restore them to the input, otherwise the user perceives a silent drop
 *   (#616).
 */
export function handleInterrupted(
  state: SessionState,
  event: InterruptedEvent
): ProcessResult {
  const { session } = state
  const effects: Effect[] = []
  const isUserInitiated = !!event.message

  // Clear transient streaming state (isPending, isStreaming) and mark running tools as interrupted
  // These fields are not persisted, so this matches the state after a reload
  // Also filter out status messages - they are transient UI state that shouldn't persist after interruption
  const updatedMessages = session.messages
    .filter(m => m.role !== 'status')  // Remove transient status messages
    // Only drop queued bubbles when the user explicitly stopped — silent
    // redirects auto-replay them so they must remain visible (#616).
    .filter(m => !(isUserInitiated && m.isQueued))
    .map(m => {
      // Mark running tools as interrupted
      if (m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error') {
        return { ...m, toolStatus: 'error' as const, toolResult: 'Interrupted', isError: true }
      }
      // Clear transient streaming flags even if only isStreaming was set.
      if (m.role === 'assistant' && (m.isPending || m.isStreaming)) {
        return { ...m, isPending: false, isStreaming: false }
      }
      return m
    })

  // Only add the "Response interrupted" message if provided (not a silent redirect)
  const messages = event.message
    ? [...updatedMessages, event.message]
    : updatedMessages

  // Restore queued message text to the input field — only on user-initiated
  // stops. Silent redirects keep the bubble in chat and rely on the backend's
  // auto-replay (#616).
  if (isUserInitiated && event.queuedMessages && event.queuedMessages.length > 0) {
    effects.push({
      type: 'restore_input',
      text: event.queuedMessages.join('\n\n'),
    })
  }

  if (isUserInitiated && typeof event.runningChildCount === 'number' && event.runningChildCount > 0) {
    effects.push({
      type: 'toast_running_children',
      count: event.runningChildCount,
    })
  }

  return {
    state: {
      session: {
        ...session,
        isProcessing: false,
        messages,
        currentStatus: undefined,  // Clear any lingering status
        processingStartedAt: undefined,
        suppressedTurnIds: undefined,
      },
      streaming: null,
    },
    effects,
  }
}

/**
 * Handle title_generated - update session title and clear regenerating state
 */
export function handleTitleGenerated(
  state: SessionState,
  event: TitleGeneratedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        name: event.title,
        // Clear regenerating state - title generation completed
        isRegeneratingTitle: false,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle title_regenerating - set regenerating state for shimmer effect
 * @deprecated Use handleAsyncOperation instead
 */
export function handleTitleRegenerating(
  state: SessionState,
  event: TitleRegeneratingEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        isRegeneratingTitle: event.isRegenerating,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle async_operation - set async operation state for shimmer effect
 * Generic handler for any async operation (sharing, updating share, revoking, title regeneration)
 */
export function handleAsyncOperation(
  state: SessionState,
  event: AsyncOperationEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        isAsyncOperationOngoing: event.isOngoing,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle working_directory_changed - update session working directory (user-initiated via UI)
 */
export function handleWorkingDirectoryChanged(
  state: SessionState,
  event: WorkingDirectoryChangedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: { ...session, workingDirectory: event.workingDirectory },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle permission_mode_changed - return effect for parent to handle session options
 */
export function handlePermissionModeChanged(
  state: SessionState,
  event: PermissionModeChangedEvent
): ProcessResult {
  return {
    state,
    effects: [{
      type: 'permission_mode_changed',
      sessionId: event.sessionId,
      permissionMode: event.permissionMode,
      previousPermissionMode: event.previousPermissionMode,
      transitionDisplay: event.transitionDisplay,
      modeVersion: event.modeVersion,
      changedAt: event.changedAt,
      changedBy: event.changedBy,
    }],
  }
}

/**
 * Handle session_model_changed - update session model
 */
export function handleSessionModelChanged(
  state: SessionState,
  event: SessionModelChangedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: { ...session, model: event.model ?? undefined },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle connection_changed - sync session.llmConnection to renderer state
 */
export function handleConnectionChanged(
  state: SessionState,
  event: LLMConnectionChangedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        llmConnection: event.connectionSlug,
        ...(event.supportsBranching !== undefined && { supportsBranching: event.supportsBranching }),
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle user_message - confirms optimistic user message from backend
 *
 * Three statuses:
 * - 'accepted': Message is being processed (confirms optimistic message)
 * - 'queued': Message was queued during ongoing response (adds if not present, marks as queued)
 * - 'processing': Queued message is now being processed (updates status)
 */
export function handleUserMessage(
  state: SessionState,
  event: UserMessageEvent
): ProcessResult {
  const { session, streaming } = state
  const { message, status } = event

  const existingQueued = session.messages.find(m =>
    m.role === 'user' && m.isQueued && (
      m.id === message.id ||
      (event.optimisticMessageId && m.id === event.optimisticMessageId) ||
      (event.optimisticMessageId && m.clientMessageId === event.optimisticMessageId) ||
      m.queueId === message.id
    ),
  )
  const incomingIds = new Set(
    [message.id, event.optimisticMessageId, existingQueued?.id, existingQueued?.queueId]
      .filter((id): id is string => !!id),
  )
  // Send-now / mid-stream steer: hide the in-flight body and let the
  // follow-up start a new reply, matching Codex / Grok.
  // A queued ack alone is not enough: after Stop, leftover work-chain
  // rows can make the next "继续" look queued while the backend is idle.
  // Collapsing then hides the already-generated body (#101).
  const hasInFlightAssistant = session.messages.some(candidate =>
    candidate.role === 'assistant' && !candidate.hidden && (candidate.isStreaming || candidate.isPending),
  )
  const hasOpenGeneration = streaming !== null || sessionHasLiveGeneration(session)
  // Hidden system continuations may drive another model turn, but they are not
  // user-authored redirects and must never suppress/collapse the visible reply.
  const collapsesOpenTurn = !message.hidden && status === 'accepted' && hasOpenGeneration && hasInFlightAssistant
  const seedMessages = collapsesOpenTurn && !existingQueued
    ? [...session.messages, { ...message, isQueued: false, isPending: false }]
    : session.messages
  const boundaryMessages = collapsesOpenTurn
    ? applySteerTranscriptBoundary(seedMessages, incomingIds)
    : session.messages

  // Find existing message by ID match (backend ID, optimistic ID, queue id, or content+timestamp fallback)
  const existingIndex = boundaryMessages.findIndex(m =>
    m.role === 'user' && (
      m.id === message.id ||
      (event.optimisticMessageId && m.id === event.optimisticMessageId) ||
      (event.optimisticMessageId && m.clientMessageId === event.optimisticMessageId) ||
      m.queueId === message.id ||
      (m.content === message.content && Math.abs(m.timestamp - message.timestamp) < 5000)
    )
  )
  const followUpTimestamp = Math.max(
    message.timestamp,
    ...boundaryMessages
      .filter(candidate =>
        !candidate.hidden
        && !(candidate.role === 'user' && (
          candidate.isQueued
          || candidate.id === existingQueued?.id
          || candidate.queueId === message.id
        )),
      )
      .map(candidate => candidate.timestamp),
  )
  const suppressedTurnIds = status === 'processing'
    ? undefined
    : collapsesOpenTurn
      ? [
          ...new Set([
            ...(session.suppressedTurnIds ?? []),
            ...collectOpenAssistantTurnIds(session.messages, streaming?.turnId),
          ]),
        ]
      : session.suppressedTurnIds
  const isHiddenUserMessage = !!message.hidden
    || (existingIndex >= 0 && !!boundaryMessages[existingIndex]?.hidden)

  let updatedMessages: Message[]

  if (existingIndex >= 0) {
    const existingMessage = boundaryMessages[existingIndex]

    // Event sequence protection: don't regress from 'processing' back to 'queued'
    // when a late queued ack arrives after the message is already confirmed.
    // Optimistic follow-ups can be inserted with isQueued: false if live
    // generation was missed at send time — those are still pending and must
    // accept a legitimate queued ack (#94).
    if (status === 'queued' && existingMessage.isQueued === false && !existingMessage.isPending) {
      return { state, effects: [] }
    }

    // Update existing message — clear isPending, set isQueued based on status.
    //
    // - 'queued'     → isQueued = true  (Claude path: backend queued for re-send)
    // - 'processing' → isQueued = false (queued message is now actually running)
    // - 'accepted'   → isQueued = false (Pi steer path: agent has the message)
    //
    // A queued message is re-stamped by SessionManager when replay starts so it
    // sorts after the prior turn's final assistant response. Apply that canonical
    // timestamp on the processing transition; otherwise the already-mounted
    // optimistic bubble keeps its queue-time timestamp until the session reloads.
    //
    // We deliberately do NOT swap `m.id` to the backend's canonical id here.
    // ChatDisplay's `getTurnKey` keys user-message bubbles by id, and a swap
    // would unmount/remount the UserMessageBubble — wiping its local timer
    // state and dropping the queued chip mid-flight. The canonical backend
    // id is irrelevant to subsequent events: they all use
    // `event.optimisticMessageId` for routing (see the findIndex above).
    updatedMessages = boundaryMessages.map((m, i) => {
      if (i === existingIndex) {
        return {
          ...m,
          ...((status === 'processing' && existingMessage.isQueued) || (status === 'accepted' && !collapsesOpenTurn)
            ? { timestamp: followUpTimestamp }
            : {}),
          isPending: false,
          isQueued: status === 'queued',
          clientMessageId: message.clientMessageId ?? m.clientMessageId,
          // Backend visibility is canonical. This is essential when a legacy
          // renderer optimistically inserted an auto-retry as a visible bubble
          // before the server identified it as an internal continuation.
          hidden: message.hidden ?? m.hidden,
          ...(status === 'queued'
            ? { queueId: message.id }
            : existingQueued
              ? { queueId: m.queueId ?? message.id }
              : { queueId: undefined }),
        }
      }
      return m
    })
  } else {
    // Message not found (e.g., queued message from backend) - add it
    const newMessage: Message = {
      ...message,
      timestamp: status === 'queued' ? message.timestamp : followUpTimestamp,
      isPending: false,
      isQueued: status === 'queued',
      ...(status === 'queued' ? { queueId: message.id } : {}),
    }
    updatedMessages = [...boundaryMessages, newMessage]
  }

  return {
    state: {
      session: {
        ...session,
        messages: updatedMessages,
        // A queued item belongs to the composer, so it must not affect session
        // ordering, preview role, or transcript-derived badges before replay.
        ...(status !== 'queued' && !isHiddenUserMessage && {
          lastMessageAt: Date.now(),
          lastMessageRole: 'user' as const,
        }),
        // Set isProcessing when message is accepted/processing (enables multi-window sync)
        // Every user_message acknowledgement belongs to an active turn. Queueing
        // is orthogonal to that turn, so it must never clear its running state,
        // timer, or streaming content (including in a newly opened window).
        isProcessing: true,
        processingStartedAt: collapsesOpenTurn
          ? Date.now()
          : (session.processingStartedAt ?? Date.now()),
        suppressedTurnIds,
      },
      streaming: collapsesOpenTurn ? null : streaming,
    },
    effects: [],
  }
}

/** Replace only visible queued messages while preserving formal and hidden turns. */
export function handleQueueChanged(
  state: SessionState,
  event: QueueChangedEvent,
): ProcessResult {
  const existingQueued = state.session.messages.filter(
    message => message.role === 'user' && message.isQueued && !message.hidden,
  )
  const formalAndHiddenMessages = state.session.messages.filter(
    message => !(message.role === 'user' && message.isQueued && !message.hidden),
  )

  const queuedMessages = event.messages.map((message) => {
    const existing = existingQueued.find(candidate =>
      candidate.id === message.id || candidate.queueId === message.id,
    )
    return {
      ...message,
      id: existing?.id ?? message.id,
      queueId: message.id,
      isPending: false,
      isQueued: true,
    }
  })

  return {
    state: {
      ...state,
      session: {
        ...state.session,
        messages: [...formalAndHiddenMessages, ...queuedMessages],
      },
    },
    effects: [],
  }
}

/**
 * Handle message_annotations_updated - update annotations on a specific message.
 */
export function handleMessageAnnotationsUpdated(
  state: SessionState,
  event: MessageAnnotationsUpdatedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        messages: session.messages.map(m =>
          m.id === event.messageId
            ? { ...m, annotations: event.annotations }
            : m
        ),
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle sources_changed - update session's enabled sources
 */
export function handleSourcesChanged(
  state: SessionState,
  event: SourcesChangedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        enabledSourceSlugs: event.enabledSourceSlugs,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle labels_changed - update session's labels
 */
export function handleLabelsChanged(
  state: SessionState,
  event: LabelsChangedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        labels: event.labels,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle project_id_changed - update session's projectId binding
 */
export function handleProjectIdChanged(
  state: SessionState,
  event: ProjectIdChangedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        projectId: event.projectId ?? undefined,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle session_status_changed - update session's sessionStatus (external metadata change or agent tool)
 */
export function handleSessionStatusChanged(
  state: SessionState,
  event: SessionStatusChangedEvent
): ProcessResult {
  const { session, streaming } = state
  return {
    state: {
      session: { ...session, sessionStatus: event.sessionStatus },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle session_metadata_changed - merge programmatic metadata changes (taskNodeCount,
 * kanbanColumn, and the taskDraft→taskSlug promotion on orchestrator adoption) that don't
 * propagate via the header-signature file watch.
 */
export function handleSessionMetadataChanged(
  state: SessionState,
  event: SessionMetadataChangedEvent
): ProcessResult {
  const { session, streaming } = state
  return {
    state: {
      session: { ...session, ...event.changes },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle session_flagged - mark session as flagged
 */
export function handleSessionFlagged(
  state: SessionState,
  _event: SessionFlaggedEvent
): ProcessResult {
  const { session, streaming } = state
  return {
    state: {
      session: { ...session, isFlagged: true },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle session_unflagged - mark session as unflagged
 */
export function handleSessionUnflagged(
  state: SessionState,
  _event: SessionUnflaggedEvent
): ProcessResult {
  const { session, streaming } = state
  return {
    state: {
      session: { ...session, isFlagged: false },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle session_archived - mark session as archived
 */
export function handleSessionArchived(
  state: SessionState,
  _event: SessionArchivedEvent
): ProcessResult {
  const { session, streaming } = state
  return {
    state: {
      session: { ...session, isArchived: true, archivedAt: Date.now() },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle session_unarchived - mark session as unarchived
 */
export function handleSessionUnarchived(
  state: SessionState,
  _event: SessionUnarchivedEvent
): ProcessResult {
  const { session, streaming } = state
  return {
    state: {
      session: { ...session, isArchived: false, archivedAt: undefined },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle name_changed - update session name (external metadata change)
 */
export function handleNameChanged(
  state: SessionState,
  event: NameChangedEvent
): ProcessResult {
  const { session, streaming } = state
  return {
    state: {
      session: { ...session, name: event.name },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle permission_request - return effect for parent to handle
 */
export function handlePermissionRequest(
  state: SessionState,
  event: PermissionRequestEvent
): ProcessResult {
  return {
    state,
    effects: [{
      type: 'permission_request',
      request: event.request,
    }]
  }
}

/**
 * Handle credential_request - return effect for parent to handle
 */
export function handleCredentialRequest(
  state: SessionState,
  event: CredentialRequestEvent
): ProcessResult {
  return {
    state,
    effects: [{
      type: 'credential_request',
      request: event.request,
    }]
  }
}

/**
 * Handle plan_submitted - add plan message to session
 */
export function handlePlanSubmitted(
  state: SessionState,
  event: PlanSubmittedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: appendMessage(session, event.message),
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle session_shared - session was shared to viewer
 */
export function handleSessionShared(
  state: SessionState,
  event: SessionSharedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        sharedUrl: event.sharedUrl,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle session_unshared - session share was revoked
 */
export function handleSessionUnshared(
  state: SessionState,
  _event: SessionUnsharedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        sharedUrl: undefined,
        sharedId: undefined,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle auth_request - add auth-request message to session
 * This is the unified auth flow - execution is paused until auth completes
 */
export function handleAuthRequest(
  state: SessionState,
  event: AuthRequestEvent
): ProcessResult {
  const { session, streaming } = state

  // Add auth-request message to session
  return {
    state: {
      session: {
        ...appendMessage(session, event.message),
        isProcessing: false,  // Agent execution is paused
        processingStartedAt: undefined,
      },
      streaming: null,  // Clear any streaming state
    },
    effects: [],
  }
}

/**
 * Handle auth_completed - update auth-request message status
 * The agent will resume via a new user message (sent by session manager)
 */
export function handleAuthCompleted(
  state: SessionState,
  event: AuthCompletedEvent
): ProcessResult {
  const { session, streaming } = state

  // Update the auth-request message status
  const updatedMessages = session.messages.map(m => {
    if (
      m.role === 'auth-request' &&
      m.authRequestId === event.requestId &&
      m.authStatus === 'pending'
    ) {
      return {
        ...m,
        authStatus: event.success
          ? ('completed' as const)
          : event.cancelled
            ? ('cancelled' as const)
            : ('failed' as const),
        authError: event.error,
      }
    }
    return m
  })

  return {
    state: {
      session: {
        ...session,
        messages: updatedMessages,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle usage_update - real-time context usage during processing
 * Merges usage update into existing tokenUsage (preserves outputTokens, costUsd, etc.)
 */
export function handleUsageUpdate(
  state: SessionState,
  event: UsageUpdateEvent
): ProcessResult {
  const { session, streaming } = state

  // The server sends a complete snapshot so lastCall and the in-progress
  // accounting remain consistent across desktop and web renderers.
  const updatedTokenUsage = event.tokenUsage

  return {
    state: {
      session: {
        ...session,
        tokenUsage: updatedTokenUsage,
      },
      streaming,
    },
    effects: [],
  }
}

/** Enter regenerate running state without discarding the committed response. */
export function handleRegenerateStarted(
  state: SessionState,
  _event: RegenerateStartedEvent,
): ProcessResult {
  return {
    state: {
      session: {
        ...state.session,
        isProcessing: true,
        currentStatus: undefined,
        processingStartedAt: Date.now(),
      },
      streaming: null,
    },
    effects: [],
  }
}

/** Keep transcript through the last user prompt once the new run is ready. */
export function handleMessagesTruncated(
  state: SessionState,
  event: MessagesTruncatedEvent,
): ProcessResult {
  const { session } = state
  let keepIdx = session.messages.findIndex(m => m.id === event.keepThroughMessageId)
  // Renderer keeps the optimistic user-message id; after regenerate the
  // backend id may not match. Fall back to the last user prompt.
  if (keepIdx === -1) {
    keepIdx = session.messages.findLastIndex(m => m.role === 'user' && !m.hidden)
  }
  if (keepIdx === -1) {
    return { state, effects: [] }
  }

  return {
    state: {
      session: {
        ...session,
        messages: session.messages.slice(0, keepIdx + 1),
        // Regenerating reuses the existing user prompt and skips `user_message`,
        // which is the event that normally sets isProcessing. Enter the same
        // running state as a fresh send so the input shows Stop immediately.
        isProcessing: true,
        currentStatus: undefined,
        // Reuse the original user-message timestamp for history, but start the
        // elapsed-time clock from this regenerate so the indicator does not
        // show time since the first send (e.g. 130:34).
        processingStartedAt: Date.now(),
      },
      streaming: null,
    },
    effects: [],
  }
}

/** Restore the pre-regenerate transcript while retaining the surfaced error. */
export function handleMessagesRestored(
  state: SessionState,
  event: MessagesRestoredEvent,
): ProcessResult {
  const restoredIds = new Set(event.messages.map(message => message.id))
  const diagnostics = state.session.messages.filter(message =>
    (message.role === 'error' || message.role === 'info') && !restoredIds.has(message.id)
  )

  return {
    state: {
      session: {
        ...state.session,
        messages: [...event.messages, ...diagnostics],
        isProcessing: false,
        currentStatus: undefined,
        processingStartedAt: undefined,
      },
      streaming: null,
    },
    effects: [],
  }
}
