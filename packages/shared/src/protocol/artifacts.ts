export interface ArtifactVersion {
  ordinal?: number; id: string; hash: string; size: number; createdAt: number; sourceRunId?: string; restoredFrom?: string; summary?: string; summaryOrigin?: 'assistant'
}
export interface BodyFeedbackRevision {
  requestMessageId: string; createdAt: number; instruction: string; sourceContentHash?: string; original?: string
  result?: { messageId: string; content: string; salvaged: boolean }
  userResolvedAt?: number
}
export interface ManagedArtifact {
  version: 1; id: string; hostId: string; workspaceId: string; path: string; currentVersion: string; versions: ArtifactVersion[]
  currentFileAvailable?: boolean
}
export type ArtifactOperation =
  | { type: 'register'; path: string; alternativePaths?: string[]; sessionId?: string; versionId?: string }
  | { type: 'read'; artifactId: string }
  | { type: 'restore'; artifactId: string; expectedVersion: string; versionId: string }
  | { type: 'restoreForSession'; sessionId: string; artifactId: string; expectedVersion: string; versionId: string }
  | { type: 'relocate'; artifactId: string; path: string; expectedVersion: string }
export interface ArtifactFeedback {
  officeSelection?: OfficeSelection
  revision?: number
  version: 1; id: string; sessionId: string; artifactId: string; baseVersion: string; instruction: string
  validationInputs?: string[]
  anchor?: { hash: string; start: number; end: number; text: string }
  status: 'queued' | 'running' | 'validating' | 'applied' | 'conflict' | 'failed' | 'cancelled'
  createdAt: number; updatedAt: number; childSessionId?: string; appliedVersion?: string
  validation?: string[]; error?: string; userResolved?: boolean
}
export type ArtifactFeedbackOperation =
  | { type: 'create'; sessionId: string; requestId: string; artifactId: string; baseVersion: string; instruction: string; validationRoot?: string; validationInputs?: string[]; anchor?: ArtifactFeedback['anchor']; officeSelection?: OfficeSelection }
  | { type: 'get'; sessionId: string; feedbackId: string }
  | { type: 'resolve'; sessionId: string; feedbackId: string }
  | { type: 'cancel'; sessionId: string; feedbackId: string }

/** Host-captured, immutable Office targets. Never use the transient `selected` path to edit. */
export interface OfficeSelection {
  previewId: string; artifactId: string; baseVersion: string; hash: string; path: string
  elements: Array<{ path: string; type: string; summary: string; digest: string }>
}
export type OfficePreviewOperation =
  | { type: 'open'; sessionId: string; path: string; previewId?: string }
  | { type: 'select'; sessionId: string; previewId: string; paths: string[] }
  | { type: 'capture' | 'heartbeat' | 'refresh' | 'suspend' | 'close'; sessionId: string; previewId: string }
export const OFFICE_PREVIEW_MAX_OPEN = 5
export const OFFICE_PREVIEW_IDLE_TTL_MS = 6 * 60 * 60 * 1000
export const OFFICE_PREVIEW_MAX_SELECTION = 256
export interface OfficePreviewResult {
  previewId: string; artifactId: string; baseVersion: string; path: string
  html?: string; selection?: OfficeSelection
  isDraft?: boolean
}
