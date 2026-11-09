/** Aggregate visible, settled unread conversations without changing read state. */
export function sessionCompletionAttention(sessions: Iterable<{
  projectId?: string; hasUnread?: boolean; isProcessing?: boolean; hidden?: boolean; isArchived?: boolean
}>) {
  let ordinary = false
  const projects = new Set<string>()
  const runningProjects = new Set<string>()
  for (const session of sessions) {
    if (session.hidden || session.isArchived) continue
    if (session.isProcessing && session.projectId) runningProjects.add(session.projectId)
    if (!session.hasUnread || session.isProcessing) continue
    if (session.projectId) projects.add(session.projectId)
    else ordinary = true
  }
  return { ordinary, projects, runningProjects }
}
