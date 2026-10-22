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
export { ResponseActionRow, TurnActionButton, TurnRetryButton, TURN_ACTION_ICON_CLASS } from './TurnActionRow'
export { TodoList } from './TodoList'
export { TaskProgressCard, TaskTurnSummary, TaskProgressSummary, useSessionTaskCard } from './TaskProgressCard'
export {
  taskStepProgress,
  snapshotFromTodos,
  taskListSignature,
  latestTodoList,
  todoRailForTurn,
  reduceTaskCardMemory,
  reduceSessionTaskCards,
  sessionTaskCardMemory,
  isTaskCardVisible,
  isTaskCardDocked,
  taskTurnInterrupted,
  EMPTY_TASK_CARD_MEMORY,
  EMPTY_SESSION_TASK_CARDS,
  TASK_CARD_EXIT_MS,
  TASK_CARD_CAPSULE_CLEARANCE,
} from './task-progress'
export {
  centeredShellBudget,
  toolbarCapsuleFit,
  TOOLBAR_BUTTON_GAP,
  TOOLBAR_CAPSULE_CONTENT_HEIGHT,
  TOOLBAR_CAPSULE_RADIUS,
  TOOLBAR_CLUSTER_GAP,
  TOOLBAR_CONTROL_HEIGHT,
  TOOLBAR_SCROLL_SIZE,
  TOOLBAR_SHELL_BORDER,
  TOOLBAR_SHELL_MAX,
} from './toolbar-capsule-fit'
export type { ToolbarCapsuleFit, ToolbarCapsuleFitInput } from './toolbar-capsule-fit'
export type { TodoRailMode, TaskCardMemory, TaskCardEvent, TaskCardPhase, TaskListSnapshot, SessionTaskCards, SessionTaskCardEvent } from './task-progress'
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
