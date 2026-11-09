/**
 * Working-folder rules for projects.
 *
 * Creating a project requires a folder. Editing cannot clear one that is
 * already set. A project saved before this rule still opens: the settings
 * panel asks for a folder instead of failing the page.
 */

export function folderNameFromPath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  if (!trimmed) return ''
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? trimmed
}

/**
 * Use the folder name when the project name is still empty or still the
 * previous suggestion. A name the user typed is left as they wrote it.
 */
export function suggestProjectNameFromFolder(input: {
  currentName: string
  previousSuggestion: string
  folderPath: string
}): { name: string; suggestion: string } {
  const suggestion = folderNameFromPath(input.folderPath)
  const current = input.currentName.trim()
  const previous = input.previousSuggestion.trim()
  const replace = current.length === 0 || current === previous
  return {
    name: replace ? suggestion : input.currentName,
    suggestion,
  }
}

/** Why creation cannot proceed. Folder is checked before the name. */
export function createProjectBlocker(input: {
  name: string
  workingDirectory: string
}): 'folder' | 'name' | null {
  if (!input.workingDirectory.trim()) return 'folder'
  if (!input.name.trim()) return 'name'
  return null
}

/**
 * `missing` means a legacy project still needs a folder (show a prompt).
 * `cleared` means a saved folder would be wiped (block the save).
 */
export function projectWorkingDirectorySaveIssue(input: {
  storedWorkingDirectory?: string | null
  nextWorkingDirectory: string
}): 'cleared' | 'missing' | null {
  const stored = input.storedWorkingDirectory?.trim() ?? ''
  const next = input.nextWorkingDirectory.trim()
  if (stored && !next) return 'cleared'
  if (!next) return 'missing'
  return null
}

export function requireCreateProjectFields(input: {
  name?: string | null
  workingDirectory?: string | null
}): { name: string; workingDirectory: string } {
  const name = input.name?.trim() ?? ''
  const workingDirectory = input.workingDirectory?.trim() ?? ''
  if (!name) {
    throw new Error('Project name is required')
  }
  if (!workingDirectory) {
    throw new Error('Working directory is required')
  }
  return { name, workingDirectory }
}

export interface ProjectConversationIdentity {
  projectId?: string | null
  hidden?: boolean
  parentSessionId?: string | null
  orchestrationRole?: string | null
}

/**
 * A project conversation is a session the user opened inside a project.
 * Hidden workers, reviewers, and spawned children keep their own directories.
 */
export function isProjectConversation(session: ProjectConversationIdentity): boolean {
  if (!session.projectId?.trim()) return false
  if (session.hidden) return false
  if (session.parentSessionId) return false
  if (session.orchestrationRole === 'worker' || session.orchestrationRole === 'reviewer') return false
  return true
}

/**
 * Directory a project conversation must use.
 * `null` means the session is not locked.
 * `undefined` means it is locked, but the project has no folder yet.
 */
export function requiredProjectConversationDirectory(
  session: ProjectConversationIdentity,
  projectWorkingDirectory: string | null | undefined,
): string | undefined | null {
  if (!isProjectConversation(session)) return null
  return projectWorkingDirectory?.trim() || undefined
}

/**
 * Directory stored on a newly created session.
 *
 * A project conversation with a folder always uses that folder.
 * A project conversation whose folder is not chosen yet keeps the directory
 * already resolved from the workspace default or an explicit path. Replacing
 * it with `undefined` makes the agent fall back to the workspace storage root.
 * Workers, reviewers, and children (`required === null`) inherit the project
 * folder only when the caller did not choose one.
 */
export function resolveCreatedWorkingDirectory(input: {
  resolved: string | undefined
  required: string | null | undefined
  requested?: string | null
  projectWorkingDirectory?: string | null
}): string | undefined {
  if (typeof input.required === 'string') {
    const folder = input.required.trim()
    return folder || input.resolved
  }
  if (input.required === undefined) return input.resolved
  const inherit = input.requested == null || input.requested === 'user_default'
  const projectFolder = input.projectWorkingDirectory?.trim()
  if (inherit && projectFolder) return projectFolder
  return input.resolved
}

/** Session ids whose stored cwd should be rewritten to the project folder. */
export function projectConversationDirectoryUpdates(input: {
  projectId: string
  workingDirectory: string
  sessions: Array<ProjectConversationIdentity & { id: string; workingDirectory?: string; isolated?: boolean }>
}): string[] {
  const folder = input.workingDirectory.trim()
  if (!folder) return []
  const ids: string[] = []
  for (const session of input.sessions) {
    if (session.isolated) continue
    if (session.projectId !== input.projectId) continue
    if (!isProjectConversation(session)) continue
    if (session.workingDirectory === folder) continue
    ids.push(session.id)
  }
  return ids
}

export function applyWorkingDirectoryPatch<T extends object>(
  existingWorkingDirectory: string | undefined,
  patch: T,
): T {
  if (!Object.prototype.hasOwnProperty.call(patch, 'workingDirectory')) return patch
  const value = (patch as { workingDirectory?: string }).workingDirectory
  const next = value?.trim() || undefined
  if (!next && existingWorkingDirectory?.trim()) {
    throw new Error('Working directory cannot be cleared')
  }
  return { ...patch, workingDirectory: next } as T
}
