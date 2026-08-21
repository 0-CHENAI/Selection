import type { Message, StoredMessage } from './message.ts';

/**
 * Convert runtime Message to StoredMessage for persistence.
 *
 * Excludes transient runtime-only fields:
 * - isStreaming
 * - isPending
 * - queueId
 * - toolResultContent (may contain large inline image Base64)
 */
export function messageToStored(msg: Message): StoredMessage {
  const { role, isStreaming, isPending, queueId, toolResultContent, ...rest } = msg;
  return { ...rest, type: role } as StoredMessage;
}

/**
 * Convert StoredMessage to runtime Message.
 *
 * Adds a timestamp fallback for legacy messages where timestamp was omitted.
 */
export function storedToMessage(stored: StoredMessage): Message {
  const { type, ...rest } = stored;
  return { ...rest, role: type, timestamp: stored.timestamp ?? Date.now() } as Message;
}
