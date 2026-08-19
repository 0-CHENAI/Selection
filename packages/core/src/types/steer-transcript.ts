import type { Message } from './message.ts'

export function isSteerFollowUp(message: Message, incomingIds: Set<string>): boolean {
  return message.role === 'user' && (
    incomingIds.has(message.id)
    || (message.queueId != null && incomingIds.has(message.queueId))
  )
}

export function isThoughtChainMessage(message: Message): boolean {
  if (message.hidden) return false
  if (message.role === 'tool' || message.role === 'status') return true
  return message.role === 'assistant' && !!message.isIntermediate
}

export function isOpenResponseBody(message: Message): boolean {
  return message.role === 'assistant' && !message.hidden && !message.isIntermediate
}

/**
 * Place a mid-stream follow-up under the original prompt and move the open
 * thought chain below it. Only the interrupted response body is hidden.
 */
export function applySteerTranscriptBoundary(
  messages: Message[],
  incomingIds: Set<string>,
  now: () => number = Date.now,
): Message[] {
  let lastAnchorIndex = -1
  for (let i = 0; i < messages.length; i++) {
    const candidate = messages[i]
    if (candidate.role !== 'user' || candidate.hidden || candidate.isQueued) continue
    if (isSteerFollowUp(candidate, incomingIds)) continue
    if (candidate.queueId) continue
    lastAnchorIndex = i
  }

  const kept: Message[] = []
  const generationChain: Message[] = []
  let incoming: Message | undefined
  for (let i = 0; i < messages.length; i++) {
    const candidate = messages[i]
    if (isSteerFollowUp(candidate, incomingIds)) {
      incoming = candidate
      continue
    }
    if (candidate.role === 'user' && candidate.isQueued) {
      kept.push(candidate)
      continue
    }
    if (i <= lastAnchorIndex) {
      kept.push(candidate)
      continue
    }
    if (isThoughtChainMessage(candidate)) {
      generationChain.push(candidate)
      continue
    }
    if (candidate.role === 'user' || isOpenResponseBody(candidate)) {
      kept.push({
        ...candidate,
        hidden: true,
        isQueued: false,
        isStreaming: false,
        isPending: false,
        ...(candidate.turnId ? { turnId: `closed-before-steer:${candidate.id}` } : {}),
      })
      continue
    }
    kept.push(candidate)
  }

  if (!incoming) {
    return [...kept, ...generationChain]
  }

  const followUpTimestamp = Math.max(
    incoming.timestamp,
    now(),
    ...kept.map(candidate => candidate.timestamp),
    ...generationChain.map(candidate => candidate.timestamp),
  ) + 1

  kept.push({
    ...incoming,
    hidden: false,
    isQueued: false,
    isPending: false,
    timestamp: followUpTimestamp,
    queueId: incoming.queueId ?? [...incomingIds][0],
  })

  let chainTimestamp = followUpTimestamp
  for (const item of generationChain) {
    chainTimestamp += 1
    kept.push({
      ...item,
      hidden: false,
      timestamp: chainTimestamp,
    })
  }
  return kept
}
