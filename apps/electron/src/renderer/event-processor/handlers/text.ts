/**
 * Text Event Handlers
 *
 * Handles text_delta and text_complete events.
 * Pure functions that return new state - no side effects.
 */

import type { SessionState, StreamingState, TextDeltaEvent, TextCompleteEvent } from '../types'
import type { Message } from '../../../shared/types'
import type { TextStreamPhase } from '@craft-agent/core/types'
import { hasRenderableAssistantText, isAnswerDeliveryReceipt, preferRicherAssistantText } from '@craft-agent/core'
import { streamTrace } from '@craft-agent/shared/stream-trace'
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

function incomingTextPhase(event: TextDeltaEvent): TextStreamPhase {
  if (event.answerProtocol === 'explicit-v1') return event.phase ?? 'unclassified'
  if (event.presentationProtocol && event.presentationProtocol !== 'legacy') {
    return event.phase ?? 'unclassified'
  }
  return event.phase === 'intermediate' ? 'intermediate' : 'final'
}

function isLiveDeltaIntermediate(
  event: Pick<TextDeltaEvent, 'answerProtocol' | 'presentationProtocol'>,
  phase: TextStreamPhase,
): boolean {
  if (event.answerProtocol === 'explicit-v1') return phase === 'intermediate'
  if (event.presentationProtocol === 'marker-v1') return phase !== 'final'
  return phase === 'intermediate'
}

/**
 * Handle text_delta - accumulate streaming content
 *
 * Live tokens stay on the card unless the stream is already commentary
 * (or marker-v1 unclassified). text_complete finalizes that classification.
 * Uses turnId for lookup, never position.
 */
export function handleTextDelta(
  state: SessionState,
  event: TextDeltaEvent
): SessionState {
  const { session, streaming } = state
  streamTrace('react-delta', { chars: event.delta.length, phase: event.phase ?? '' })

  if (event.answerRunId && session.messages.some(m => m.answerCommitted && m.answerRunId === event.answerRunId)) {
    return state
  }

  if (isSuppressedTurn(session, event.turnId)) {
    return { session, streaming: null }
  }

  // Live tokens stay on the card unless this stream is already commentary
  // (or marker-v1 unclassified). text_complete reclassifies the finished body.
  const incomingPhase = incomingTextPhase(event)
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
      isIntermediate: isLiveDeltaIntermediate({
        answerProtocol: event.answerProtocol ?? currentMsg.answerProtocol,
        presentationProtocol: event.presentationProtocol ?? currentMsg.presentationProtocol,
      }, phase),
      phase,
      presentationProtocol: event.presentationProtocol ?? currentMsg.presentationProtocol,
      answerProtocol: event.answerProtocol ?? currentMsg.answerProtocol,
      answerRunId: event.answerRunId ?? currentMsg.answerRunId,
      answerRoutingVersion: event.answerRoutingVersion ?? currentMsg.answerRoutingVersion,
    })
    return { session: updatedSession, streaming: newStreaming }
  }

  // No streaming message found - create new one
  // Don't update lastMessageAt for streaming messages (they're intermediate)
  const newMessage: Message = {
    id: generateMessageId(),
    role: 'assistant',
    content: event.delta,
    answerProtocol: event.answerProtocol,
    answerRunId: event.answerRunId,
    answerRoutingVersion: event.answerRoutingVersion,
    timestamp: timestampAfterVisibleUser(session.messages),
    isStreaming: true,
    isPending: true,
    isIntermediate: isLiveDeltaIntermediate(event, phase),
    phase,
    presentationProtocol: event.presentationProtocol,
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
  event: TextCompleteEvent,
  hadAnswerPreview = false,
): SessionState {
  const { session, streaming } = state
  const completesActiveStream = !streaming
    || !event.turnId
    || !streaming.turnId
    || streaming.turnId === event.turnId
  const nextStreaming = event.answerCommitted || completesActiveStream ? null : streaming

  if (isSuppressedTurn(session, event.turnId)) {
    return { session, streaming: null }
  }

  const committed = event.answerRunId && session.messages.find(m => m.answerCommitted && m.answerRunId === event.answerRunId)
  if (committed) {
    if (event.answerCommitted) console.info('Duplicate committed answer event', { answerRunId: event.answerRunId, messageId: event.messageId })
    return state
  }
  if (event.answerCommitted && (!hasRenderableAssistantText(event.text) || isAnswerDeliveryReceipt(event.text))) return state

  // Find message by turnId (try streaming first, then any assistant)
  let msgIndex = findStreamingMessage(session.messages, event.turnId)
  if (msgIndex === -1) {
    msgIndex = findAssistantMessage(session.messages, event.turnId)
  }

  // natural-v1 commits the streamed draft in place: same id (a revealed note)
  // or the still-live stream of that turn. Sub-turn ids repeat across model
  // calls, so a completed message is only matched by its authoritative id.
  if (event.answerCommitted) {
    msgIndex = event.messageId ? session.messages.findIndex(m => m.id === event.messageId && m.role === 'assistant') : -1
    if (msgIndex === -1 && event.turnId) {
      msgIndex = session.messages.findIndex(m => m.role === 'assistant' && m.turnId === event.turnId
        && (m.isStreaming || m.isPending) && !m.answerPreview && (!m.answerRunId || m.answerRunId === event.answerRunId))
    }
  }
  const committedInPlace = !!event.answerCommitted && msgIndex !== -1

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
    // A committed answer is authoritative: it is exactly what was persisted.
    const resolvedContent = committedInPlace ? event.text : preferRicherAssistantText(
      event.text,
      streamingContentForTurn(streaming, event.turnId),
      existingMsg?.content,
    )
    // An in-place commit closes the run: order it after every other visible
    // row, but never by its own (renderer-clock) streaming timestamp.
    const nextTimestamp = committedInPlace
      ? timestampAfterVisibleUser(session.messages.filter((_, index) => index !== msgIndex), event.timestamp ?? Date.now())
      : timestampAfterVisibleUser(
        session.messages,
        event.timestamp ?? (event.isIntermediate ? existingMsg.timestamp : Date.now()),
      )
    const updatedSession = updateMessageAt(session, msgIndex, {
      // Replace temporary renderer-generated ID with authoritative main-process ID
      // so branchFromMessageId always resolves against persisted session.jsonl.
      ...(event.messageId ? { id: event.messageId } : {}),
      content: resolvedContent,
      isStreaming: false,
      isPending: false,
      isIntermediate: event.isIntermediate,
      phase: event.phase,
      presentationProtocol: event.presentationProtocol ?? (committedInPlace ? existingMsg.presentationProtocol : undefined),
      answerProtocol: event.answerProtocol,
      answerRunId: event.answerRunId,
      answerRoutingVersion: event.answerRoutingVersion,
      answerCommitted: event.answerCommitted,
      answerSalvaged: event.answerSalvaged,
      artifactVersions: event.artifactVersions,
      completedRevealStartTime: session.isProcessing && !event.isIntermediate && !hadAnswerPreview ? Date.now() : undefined,
      turnId: event.turnId ?? existingMsg.turnId,
      parentToolUseId: event.parentToolUseId,
      timestamp: nextTimestamp,
    }, shouldUpdateTimestamp)
    return { session: updatedSession, streaming: nextStreaming }
  }

  // Message not found - CREATE IT
  // This handles the race condition where text_complete arrives
  // before text_delta's setSessions has been processed
  const newMessage: Message = {
    id: event.messageId ?? generateMessageId(),
    role: 'assistant',
    content: event.answerCommitted ? event.text : preferRicherAssistantText(event.text, streamingContentForTurn(streaming, event.turnId)),
    timestamp: timestampAfterVisibleUser(session.messages, event.timestamp ?? Date.now()),
    isStreaming: false,
    isPending: false,
    isIntermediate: event.isIntermediate,
    phase: event.phase,
    presentationProtocol: event.presentationProtocol,
    answerProtocol: event.answerProtocol,
    answerRunId: event.answerRunId,
    answerRoutingVersion: event.answerRoutingVersion,
    answerCommitted: event.answerCommitted,
    answerSalvaged: event.answerSalvaged,
    artifactVersions: event.artifactVersions,
    completedRevealStartTime: session.isProcessing && !event.isIntermediate && !hadAnswerPreview ? Date.now() : undefined,
    turnId: event.turnId,
    parentToolUseId: event.parentToolUseId,
  }

  // Only update lastMessageAt for final (non-intermediate) messages
  const shouldUpdateTimestamp = !event.isIntermediate

  return {
    session: appendMessage(session, newMessage, shouldUpdateTimestamp),
    streaming: nextStreaming,
  }
}


/** Transient SDK argument preview; only accepted text_complete creates a durable answer. */
export function handleAnswerPreview(
  state: SessionState,
  event: Extract<import('../types').AgentEvent, { type: 'answer_preview' }>,
): SessionState {
  const { session } = state
  const owner = session.messages.filter(m => m.role === 'user' && !m.isQueued && !m.hidden).pop()
  if (!session.isProcessing || owner?.id !== event.userMessageId
    || session.messages.some(m => m.answerCommitted && m.answerRunId === event.answerRunId)) return state
  const previous = session.messages.find(m => m.answerPreview && m.answerRunId === event.answerRunId)
  if (!event.text && previous?.id !== `answer-preview-${event.answerRunId}-${event.toolCallId}`) return state
  if (event.text && previous?.id === `answer-preview-${event.answerRunId}-${event.toolCallId}`
    && previous.content.length > event.text.length && previous.content.startsWith(event.text)) return state
  const messages = session.messages.filter(m => !m.answerPreview).map(m =>
    m.id === owner.id && event.answerRoutingVersion === 1
      ? { ...m, answerProtocol: 'explicit-v1' as const, answerRunId: event.answerRunId, answerRoutingVersion: 1 as const } : m)
  if (event.text) messages.push({
    id: `answer-preview-${event.answerRunId}-${event.toolCallId}`, role: 'assistant', content: event.text,
    timestamp: previous?.timestamp ?? timestampAfterVisibleUser(messages),
    answerProtocol: 'explicit-v1', answerRunId: event.answerRunId,
    answerRoutingVersion: event.answerRoutingVersion, answerPreview: true,
    isStreaming: true, isPending: true, isIntermediate: false,
  })
  return { ...state, session: { ...session, messages } }
}
