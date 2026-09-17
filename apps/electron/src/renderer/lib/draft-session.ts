import type { Session } from '../../shared/types'

/** In-memory key for draft composer options. Never persisted as a real session. */
export const DRAFT_SESSION_OPTIONS_ID = '__draft__'

export function createDraftDisplaySession(input: {
  workspaceId: string
  model?: string
  llmConnection?: string
  workingDirectory?: string
  enabledSourceSlugs?: string[]
  swarmEnabled?: boolean
  projectId?: string
}): Session {
  return {
    id: DRAFT_SESSION_OPTIONS_ID,
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
