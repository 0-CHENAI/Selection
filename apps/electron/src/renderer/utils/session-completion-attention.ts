/** Aggregate running and unread indicators from the current workspace’s sidebar lists. */
export function sessionCompletionAttention(sessions: Iterable<{
  projectId?: string; hasUnread?: boolean; isProcessing?: boolean; hidden?: boolean; isArchived?: boolean
}>, officeSessions: readonly {
  hidden?: boolean; isArchived?: boolean; isProcessing?: boolean; ppt?: unknown; pptProgress?: { generating?: boolean }
}[] = []) {
  let ordinary = false
  let runningOrdinary = false
  const projects = new Set<string>()
  const runningProjects = new Set<string>()
  for (const session of sessions) {
    if (session.hidden || session.isArchived) continue
    if (session.isProcessing) {
      if (session.projectId) runningProjects.add(session.projectId)
      else runningOrdinary = true
      continue
    }
    if (!session.hasUnread) continue
    if (session.projectId) projects.add(session.projectId)
    else ordinary = true
  }
  const runningOffice = officeSessions.some(session => !session.hidden && !session.isArchived
    && (session.isProcessing || (session.ppt && session.pptProgress?.generating)))
  return { ordinary, projects, runningOrdinary, runningProjects, runningOffice }
}
