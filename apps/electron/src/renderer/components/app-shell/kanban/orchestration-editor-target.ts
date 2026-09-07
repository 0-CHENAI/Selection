import type { TaskEditorTarget } from './types'

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
