import type { TaskEditorTarget } from './types'
import type { ThoughtDocument } from '@craft-agent/shared/thought-workbench/types'

/** A detached imported draft must never inherit the previously edited task identity. */
export function workbenchEditorTarget(document: ThoughtDocument): TaskEditorTarget {
  return document.taskSlug ? { mode: 'edit', taskSlug: document.taskSlug, sessionId: '' }
    : { mode: 'create', initialProjectId: document.projectId }
}

export function isUnboundTaskEdit(target?: TaskEditorTarget): boolean {
  return target?.mode === 'edit' && !target.taskSlug
}

/** Open an existing edit target, otherwise a create editor bound to the sidebar project. */
export function resolveOrchestrationEditorTarget(
  editorTarget: TaskEditorTarget | null,
  projectId?: string | null,
): TaskEditorTarget {
  if (editorTarget) return editorTarget
  return projectId ? { mode: 'create', initialProjectId: projectId } : { mode: 'create' }
}
