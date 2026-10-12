/**
 * Editor target for the list/orchestration switcher's second view.
 * An atom (not container-local state) so the chat header's "Edit task" button
 * can point the editor at a session and then navigate to the board route.
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { TaskEditorTarget } from '@/components/app-shell/kanban/types'

// Preserve only the target identity. Unsaved drafts remain renderer-local.
export const kanbanEditorTargetAtom = atomWithStorage<TaskEditorTarget | null>(
  'craft-orchestration-editor-target', null, undefined, { getOnInit: true },
)

/**
 * Shared dirty state owned by TaskEditor so navigation controls outside the
 * editor cannot discard an unsaved orchestration without confirmation.
 */
export const kanbanEditorDirtyAtom = atom(false)
