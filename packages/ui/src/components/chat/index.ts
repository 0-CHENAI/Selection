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
export { InlineExecution, mapToolEventToActivity, type InlineExecutionProps, type InlineExecutionStatus, type InlineActivityItem } from './InlineExecution'
export { TurnCardActionsMenu, type TurnCardActionsMenuProps } from './TurnCardActionsMenu'
export { SessionViewer, type SessionViewerProps, type SessionViewerMode } from './SessionViewer'
export { UserMessageBubble, formatUserMessageTime, type UserMessageBubbleProps } from './UserMessageBubble'
export { SystemMessage, type SystemMessageProps, type SystemMessageType } from './SystemMessage'

// Attachment helpers
export { FileTypeIcon, getFileTypeLabel, type FileTypeIconProps } from './attachment-helpers'

// Accept plan dropdown (for plan cards)
export { AcceptPlanDropdown } from './AcceptPlanDropdown'

export { ResponseSourcesLayout } from './ResponseSourcesLayout'
