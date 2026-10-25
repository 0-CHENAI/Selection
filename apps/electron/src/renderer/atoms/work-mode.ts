import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'

/** Navigation only: switching this never changes a persisted session's mode. */
export const workModeViewAtom = atom<WorkMode>('NORM')

export interface DraftComposerState {
  initialized: boolean
  hydrated: boolean
  model: string
  connection?: string
  workingDirectory?: string
  workspaceWorkingDirectory?: string
  swarmEnabled: boolean
  sourceSlugs: string[]
  sourcesChosen?: boolean
  thinkingSelection?: ThinkingLevel
}
/** Draft options survive panel unmounts and are isolated by workspace/project/mode. */
export const draftComposerAtomFamily = atomFamily((_id: string) => atom<DraftComposerState>({
  initialized: false, hydrated: false, model: '', swarmEnabled: false, sourceSlugs: [],
}))

export function resolveDraftSources(state: DraftComposerState, projectId: string | null | undefined, defaults?: string[]): string[] {
  return state.sourcesChosen || !projectId ? state.sourceSlugs : defaults ?? state.sourceSlugs
}

/** Consume this draft's context choices; existing sessions own their copy. */
export function prepareNextDraft(state: DraftComposerState, projectId?: string): DraftComposerState {
  return { ...state, ...(projectId ? { initialized: false, hydrated: false } : {}),
    workingDirectory: projectId ? state.workingDirectory : undefined,
    sourceSlugs: projectId ? state.sourceSlugs : [],
    sourcesChosen: projectId ? state.sourcesChosen : false,
  }
}
