import type { TaskEditorTarget } from './types'

/** Open an existing edit target, otherwise a create editor bound to the sidebar project. */
export function resolveOrchestrationEditorTarget(
  editorTarget: TaskEditorTarget | null,
  projectId?: string | null,
): TaskEditorTarget {
  if (editorTarget) return editorTarget
  return projectId ? { mode: 'create', initialProjectId: projectId } : { mode: 'create' }
}
