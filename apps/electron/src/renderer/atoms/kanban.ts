/**
 * Editor target for the list/orchestration switcher's second view.
 * An atom (not container-local state) so the chat header's "Edit task" button
 * can point the editor at a session and then navigate to the board route.
 */

import { atom } from 'jotai'
import type { TaskEditorTarget } from '@/components/app-shell/kanban/types'

export const kanbanEditorTargetAtom = atom<TaskEditorTarget | null>(null)
