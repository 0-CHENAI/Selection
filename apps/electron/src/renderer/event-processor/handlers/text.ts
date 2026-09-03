/**
 * Text Event Handlers
 *
 * Handles text_delta and text_complete events.
 * Pure functions that return new state - no side effects.
 */

import type { SessionState, StreamingState, TextDeltaEvent, TextCompleteEvent } from '../types'
import type { Message } from '../../../shared/types'
import type { TextStreamPhase } from '@craft-agent/core/types'
import { preferRicherAssistantText } from '@craft-agent/core'
import {
  findStreamingMessage,
  findAssistantMessage,
  updateMessageAt,
  appendMessage,
  generateMessageId,
  timestampAfterVisibleUser,
  isSuppressedTurn,
} from '../helpers'

function streamingContentForTurn(
  streaming: StreamingState | null,
  turnId?: string,
): string | undefined {
  if (!streaming) return undefined
  if (turnId && streaming.turnId && streaming.turnId !== turnId) return undefined
  return streaming.content
}

function mergeTextStreamPhase(
  previous: TextStreamPhase | undefined,
  incoming: TextStreamPhase,
): TextStreamPhase {
  if (previous === 'final' || incoming === 'final') return 'final'
  if (previous === 'intermediate' || incoming === 'intermediate') return 'intermediate'
  return 'unclassified'
}

/**
 * Handle text_delta - accumulate streaming content
 *
 * Creates a new streaming message if none exists, otherwise updates existing.
 * Uses turnId for lookup, never position.
 */
export function handleTextDelta(
  state: SessionState,
  event: TextDeltaEvent
): SessionState {
  const { session, streaming } = state

  if (isSuppressedTurn(session, event.turnId)) {
    return { session, streaming: null }
  }

  // Events from current servers always carry a phase. Missing phase is a
  // compatibility path for older persisted/live senders, which historically
  // streamed directly into the response card.
  const incomingPhase = event.phase ?? 'final'
  const continuesExistingStream = !!streaming
    && (!event.turnId || !streaming.turnId || streaming.turnId === event.turnId)
  const phase = mergeTextStreamPhase(
    continuesExistingStream ? streaming.phase : undefined,
    incomingPhase,
  )

  // Accumulate only within the same classified sub-turn.
  const newStreaming: StreamingState = continuesExistingStream
    ? {
        ...streaming,
        content: streaming.content + event.delta,
        phase,
        turnId: event.turnId ?? streaming.turnId,
      }
    : {
        content: event.delta,
        phase,
        turnId: event.turnId,
      }

  // Find existing streaming message by turnId
  const streamingIndex = findStreamingMessage(session.messages, event.turnId)

  if (streamingIndex !== -1) {
    // Message exists - update its content
    const currentMsg = session.messages[streamingIndex]
    const updatedSession = updateMessageAt(session, streamingIndex, {
      content: currentMsg.content + event.delta,
      isIntermediate: phase !== 'final',
    })
    return { session: updatedSession, streaming: newStreaming }
  }

  // No streaming message found - create new one
  // Don't update lastMessageAt for streaming messages (they're intermediate)
  const newMessage: Message = {
    id: generateMessageId(),
    role: 'assistant',
    content: event.delta,
    timestamp: timestampAfterVisibleUser(session.messages),
    isStreaming: true,
    isPending: true,
    isIntermediate: phase !== 'final',
    turnId: event.turnId,
  }

  return {
    session: appendMessage(session, newMessage, false),
    streaming: newStreaming,
  }
}

/**
 * Handle text_complete - finalize the streaming message
 *
 * Sets isStreaming: false, isPending: false.
 * If message not found, CREATES it (fixes race condition bug).
 * Prefers the SDK complete text when it is real content; falls back to the
 * streamed body if complete is empty or a truncated stub such as `|`.
 */
export function handleTextComplete(
  state: SessionState,
  event: TextCompleteEvent
): SessionState {
  const { session, streaming } = state

  if (isSuppressedTurn(session, event.turnId)) {
    return { session, streaming: null }
  }

  // Find message by turnId (try streaming first, then any assistant)
  let msgIndex = findStreamingMessage(session.messages, event.turnId)
  if (msgIndex === -1) {
    msgIndex = findAssistantMessage(session.messages, event.turnId)
  }

  if (msgIndex !== -1) {
    const existingMsg = session.messages[msgIndex]

    // Don't overwrite a completed intermediate message with another intermediate —
    // each thinking block (e.g. Codex reasoning between tool calls) should be distinct
    if (!existingMsg.isStreaming && existingMsg.isIntermediate && event.isIntermediate) {
      msgIndex = -1
    }
  }

  if (msgIndex !== -1) {
    // Update existing message with final content
    // Only update lastMessageAt for final (non-intermediate) messages
    const shouldUpdateTimestamp = !event.isIntermediate
    const existingMsg = session.messages[msgIndex]
    // Prefer a renderable complete payload; recover truncation from the stream (#81).
    const resolvedContent = preferRicherAssistantText(
      event.text,
      streamingContentForTurn(streaming, event.turnId),
      existingMsg?.content,
    )
    const nextTimestamp = timestampAfterVisibleUser(
      session.messages,
      event.timestamp ?? existingMsg.timestamp,
    )
    const updatedSession = updateMessageAt(session, msgIndex, {
      // Replace temporary renderer-generated ID with authoritative main-process ID
      // so branchFromMessageId always resolves against persisted session.jsonl.
      ...(event.messageId ? { id: event.messageId } : {}),
      content: resolvedContent,
      isStreaming: false,
      isPending: false,
      isIntermediate: event.isIntermediate,
      turnId: event.turnId,
      parentToolUseId: event.parentToolUseId,
      timestamp: nextTimestamp,
    }, shouldUpdateTimestamp)
    return { session: updatedSession, streaming: null }
  }

  // Message not found - CREATE IT
  // This handles the race condition where text_complete arrives
  // before text_delta's setSessions has been processed
  const newMessage: Message = {
    id: event.messageId ?? generateMessageId(),
    role: 'assistant',
    content: preferRicherAssistantText(event.text, streamingContentForTurn(streaming, event.turnId)),
    timestamp: timestampAfterVisibleUser(session.messages, event.timestamp ?? Date.now()),
    isStreaming: false,
    isPending: false,
    isIntermediate: event.isIntermediate,
    turnId: event.turnId,
    parentToolUseId: event.parentToolUseId,
  }

  // Only update lastMessageAt for final (non-intermediate) messages
  const shouldUpdateTimestamp = !event.isIntermediate

  return {
    session: appendMessage(session, newMessage, shouldUpdateTimestamp),
    streaming: null,
  }
}
