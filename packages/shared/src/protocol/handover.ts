import type { WorkMode } from '../sessions/work-mode'

export interface HandoverLink {
  handoverId: string
  sourceSessionId: string
  sourceMessageId?: string
  snapshotVersion: number
}
export interface HandoverSnapshot {
  version: 1
  source: { workspaceId: string; sessionId: string; messageId?: string; checkpoint: string }
  targetMode: WorkMode
  capturedAt: number
  goal: string[]
  acceptance: string[]
  constraints: string[]
  decisions: string[]
  scopeAndPriority: string[]
  openQuestions: string[]
  nextSteps: string[]
  claims: Array<{ ref: string; text: string; reviewStatus: 'unreviewed'; sourceRefs: string[] }>
  actions: Array<{ ref: string; tool: string; outcome: 'completed' | 'unknown' | 'not-performed'; requestHash?: string; evidence: string; sourceSessionId: string }>
  files: Array<{ ref: string; originalPath: string; snapshotPath: string; hash: string; originalHash: string; versionId?: string; artifactId?: string; redacted?: boolean; sourceUrl?: string; urlPrompt?: string }>
  originals: Array<{ id: string; sessionId: string; role: string; text: string }>
  taskList: Array<{ id: string; content: string; status: string }>
  runs: Array<{ slug: string; runId: string; revision: number; status: string; retainedBy: string }>
  warnings: string[]
}
export interface HandoverRecord {
  version: 1
  handoverId: string
  sourceSessionId: string
  workspaceId: string
  targetMode: WorkMode
  targetSessionId?: string
  creationConfig?: { model?: string; llmConnection?: string }
  snapshotVersion: 1
  status: 'waiting' | 'prepared' | 'created' | 'applied' | 'cancelled'
  createdAt: number
  updatedAt: number
  snapshot?: HandoverSnapshot
  error?: string
  reviews: Record<string, { outcome: 'completed' | 'not-performed'; note: string }>
}
export type HandoverOperation =
  | { type: 'create'; handoverId: string; targetMode: WorkMode }
  | { type: 'get'; handoverId: string; checkSources?: boolean }
  | { type: 'list' }
  | { type: 'cancel'; handoverId: string }
  | { type: 'review'; handoverId: string; actionRef: string; outcome: 'completed' | 'not-performed'; note: string }
export interface HandoverResult {
  records: HandoverRecord[]
  changes?: Array<{ ref: string; state: 'unchanged' | 'changed' | 'missing' | 'unavailable' }>
}
