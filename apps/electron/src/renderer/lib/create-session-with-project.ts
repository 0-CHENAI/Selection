import type { CreateSessionOptions, Session } from '../../shared/types'

type CreateSession = (
  workspaceId: string,
  options?: CreateSessionOptions,
) => Promise<Session>

type SetSessionProject = (sessionId: string, projectId: string) => Promise<unknown>

/**
 * Create a session and enforce an explicitly requested project binding.
 *
 * Project-bound creation crosses the renderer/transport/server boundary. The
 * returned session is the authoritative acknowledgement of that write; when it
 * comes back unbound, repair it through the normal session command before the
 * renderer publishes the new session to its metadata atoms.
 */
export async function createSessionWithConfirmedProject(
  createSession: CreateSession,
  setSessionProject: SetSessionProject,
  workspaceId: string,
  options?: CreateSessionOptions,
): Promise<Session> {
  const session = await createSession(workspaceId, options)
  const requestedProjectId = options?.projectId

  if (!requestedProjectId || session.projectId === requestedProjectId) {
    return session
  }

  await setSessionProject(session.id, requestedProjectId)
  return { ...session, projectId: requestedProjectId }
}
