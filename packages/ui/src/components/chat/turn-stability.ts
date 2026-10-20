import type { ActivityItem, ResponseContent, TodoItem } from './TurnCard'
import type { Turn } from './turn-utils'

function sameTodos(previous: readonly TodoItem[] | undefined, next: readonly TodoItem[] | undefined): boolean {
  if (previous === next) return true
  if (!previous || !next || previous.length !== next.length) return !previous && !next
  return previous.every((todo, index) => {
    const other = next[index]
    return !!other
      && todo.id === other.id
      && todo.content === other.content
      && todo.status === other.status
      && todo.activeForm === other.activeForm
  })
}

function sameActivity(previous: ActivityItem, next: ActivityItem): boolean {
  return previous.id === next.id
    && previous.type === next.type
    && previous.status === next.status
    && previous.toolName === next.toolName
    && previous.toolPurpose === next.toolPurpose
    && previous.answerRoutingVersion === next.answerRoutingVersion
    && previous.toolUseId === next.toolUseId
    && previous.toolInput === next.toolInput
    && previous.content === next.content
    && previous.toolResultContent === next.toolResultContent
    && previous.intent === next.intent
    && previous.messageId === next.messageId
    && previous.annotations === next.annotations
    && previous.displayName === next.displayName
    && previous.toolDisplayMeta === next.toolDisplayMeta
    && previous.timestamp === next.timestamp
    && previous.error === next.error
    && previous.parentId === next.parentId
    && previous.depth === next.depth
    && previous.statusType === next.statusType
    && previous.taskId === next.taskId
    && previous.shellId === next.shellId
    && previous.elapsedSeconds === next.elapsedSeconds
    && previous.isBackground === next.isBackground
    && previous.attachments === next.attachments
    && previous.taskContext === next.taskContext
    && previous.taskNode === next.taskNode
}

function sameActivities(previous: readonly ActivityItem[], next: readonly ActivityItem[]): boolean {
  return previous.length === next.length && previous.every((activity, index) => {
    const other = next[index]
    return !!other && sameActivity(activity, other)
  })
}

function sameResponse(previous: ResponseContent | undefined, next: ResponseContent | undefined): boolean {
  if (previous === next) return true
  if (!previous || !next) return false
  return previous.text === next.text
    && previous.isStreaming === next.isStreaming
    && previous.isCommentary === next.isCommentary
    && previous.isPlan === next.isPlan
    && previous.isAnswerPreview === next.isAnswerPreview
    && previous.answerSalvaged === next.answerSalvaged
    && previous.messageId === next.messageId
    && previous.streamKey === next.streamKey
    && previous.timestamp === next.timestamp
    && previous.streamStartTime === next.streamStartTime
    && previous.completedRevealStartTime === next.completedRevealStartTime
    && previous.annotations === next.annotations
    && previous.artifactVersions === next.artifactVersions
}

/** True when a rebuilt turn would paint the same card as the one already mounted. */
export function turnsShareRenderIdentity(previous: Turn, next: Turn): boolean {
  if (previous.type !== next.type || previous.timestamp !== next.timestamp) return false
  if (previous.type !== 'assistant' || next.type !== 'assistant') {
    return 'message' in previous && 'message' in next && previous.message === next.message
  }
  return previous.turnId === next.turnId
    && previous.isStreaming === next.isStreaming
    && previous.isComplete === next.isComplete
    && previous.intent === next.intent
    && previous.answerRunId === next.answerRunId
    && previous.answerRoutingVersion === next.answerRoutingVersion
    && previous.presentationProtocol === next.presentationProtocol
    && previous.answerDelivered === next.answerDelivered
    && previous.taskRunId === next.taskRunId
    && sameResponse(previous.response, next.response)
    && sameActivities(previous.activities, next.activities)
    && sameTodos(previous.todos, next.todos)
}

/**
 * Streaming rebuilds every turn object. Reuse the mounted identity when the
 * card's inputs did not change so memoized history does not render per token.
 */
export function stabilizeTurns(previous: readonly Turn[] | undefined, next: readonly Turn[]): Turn[] {
  if (!previous?.length) return next.slice()
  let reused = 0
  const stable = next.map((turn, index) => {
    const prior = previous[index]
    if (!prior || !turnsShareRenderIdentity(prior, turn)) return turn
    reused += 1
    return prior
  })
  if (reused === next.length && previous.length === next.length) return previous.slice()
  return stable
}
