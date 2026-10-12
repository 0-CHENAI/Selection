import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import type { Session } from '../../shared/types'

/** In-memory key for draft composer options. Never persisted as a real session. */
export const DRAFT_SESSION_OPTIONS_ID = '__draft__'

export function isDraftSessionOptionsId(sessionId?: string | null): boolean {
  return sessionId === DRAFT_SESSION_OPTIONS_ID || !!sessionId?.startsWith(`${DRAFT_SESSION_OPTIONS_ID}:`)
}

export function draftSessionOptionsId(workspaceId: string, projectId: string | undefined, mode: WorkMode): string {
  return `${DRAFT_SESSION_OPTIONS_ID}:${JSON.stringify([workspaceId, projectId ?? null, mode])}`
}

/** Display inherited defaults without turning them into explicit creation overrides. */
export function resolveDraftWorkingDirectory(
  override: string | undefined,
  projectDirectory: string | undefined,
  workspaceDirectory: string | undefined,
): string | undefined {
  if (override === 'none') return undefined
  if (override !== undefined && override !== 'user_default') return override
  return projectDirectory || workspaceDirectory || undefined
}

export function createDraftDisplaySession(input: {
  id?: string
  workMode?: WorkMode
  workspaceId: string
  model?: string
  llmConnection?: string
  workingDirectory?: string
  enabledSourceSlugs?: string[]
  swarmEnabled?: boolean
  projectId?: string
}): Session {
  return {
    id: input.id ?? DRAFT_SESSION_OPTIONS_ID,
    workMode: input.workMode ?? 'NORM',
    workspaceId: input.workspaceId,
    workspaceName: '',
    lastMessageAt: 0,
    messages: [],
    isProcessing: false,
    model: input.model,
    llmConnection: input.llmConnection,
    workingDirectory: input.workingDirectory,
    enabledSourceSlugs: input.enabledSourceSlugs,
    swarmEnabled: input.swarmEnabled,
    projectId: input.projectId,
  }
}

/** One persistent session per draft, with synchronous duplicate-submit protection. */
export function createDraftSubmission<T>(create: () => Promise<T>) {
  let session: T | undefined
  let busy = false
  return async (send: (session: T) => void | Promise<void>): Promise<boolean> => {
    if (busy) return false
    busy = true
    try {
      session ??= await create()
      await send(session)
      return true
    } finally {
      busy = false
    }
  }
}
