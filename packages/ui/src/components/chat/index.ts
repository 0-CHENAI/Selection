/**
 * Chat component exports for @craft-agent/ui
 */

// Turn utilities (pure functions, no React)
export * from './turn-utils'
export * from './follow-up-helpers'
export {
  measureContentUnits,
  shouldShowContent,
  BUFFER_CONFIG,
} from './stream-buffer'
export { useStreamingReveal } from './useStreamingReveal'
export { useFrameSource } from './useFrameSource'

// Components
export { TurnCard, ResponseCard, SIZE_CONFIG, ActivityStatusIcon, HeightPresence, type TurnCardProps, type ResponseCardProps, type ActivityItem, type ActivityStatus, type ResponseContent, type TodoItem } from './TurnCard'
export { TodoList } from './TodoList'
export { TaskProgressCard, TaskTurnSummary, TaskProgressSummary, useSessionTaskCard } from './TaskProgressCard'
export {
  taskStepProgress,
  snapshotFromTodos,
  taskListSignature,
  latestTodoList,
  todoRailForTurn,
  reduceTaskCardMemory,
  isTaskCardVisible,
  isTaskCardDocked,
  shouldFadeTaskCard,
  readTaskCardMemory,
  writeTaskCardMemory,
  taskCardStorageKey,
  EMPTY_TASK_CARD_MEMORY,
  TASK_CARD_FADE_MS,
} from './task-progress'
export type { TodoRailMode, TaskCardMemory, TaskCardEvent, TaskCardPhase, TaskListSnapshot } from './task-progress'
export { InlineExecution, mapToolEventToActivity, type InlineExecutionProps, type InlineExecutionStatus, type InlineActivityItem } from './InlineExecution'
export { TurnCardActionsMenu, type TurnCardActionsMenuProps } from './TurnCardActionsMenu'
export { SessionViewer, type SessionViewerProps, type SessionViewerMode } from './SessionViewer'
export { UserMessageBubble, formatUserMessageTime, type UserMessageBubbleProps } from './UserMessageBubble'
export { ClarificationCard, ClarificationSummary, type ClarificationCardProps, type ClarificationSummaryProps, type ClarificationResponse } from './ClarificationCard'
export { SystemMessage, type SystemMessageProps, type SystemMessageType } from './SystemMessage'
export { withTaskMessagePresentation } from './task-message-presentation'

// Attachment helpers
export { FileTypeIcon, getFileTypeLabel, type FileTypeIconProps } from './attachment-helpers'

// Accept plan dropdown (for plan cards)
export { AcceptPlanDropdown } from './AcceptPlanDropdown'

export { ResponseSourcesLayout } from './ResponseSourcesLayout'
export { collectTurnResearchSources, sourceUrlKey } from './source-metadata'
export type { ResponseSource } from './response-sources'
