import { useEffect, useState } from 'react'

const emptyFiles: string[] = []

/** Discover on the session's host; late responses must never follow a chat switch. */
export function useOfficeFiles(sessionId: string | null | undefined, workspaceId?: string | null) {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; workspaceId?: string | null; files: string[] }>()
  useEffect(() => {
    if (!sessionId) return
    let disposed = false, loading = false
    const refresh = async () => {
      if (disposed || loading || !window.electronAPI.isChannelAvailable('artifacts:officeFiles')
        || !window.electronAPI.isChannelAvailable('artifacts:officePreview')) return
      loading = true
      try {
        const files = await window.electronAPI.getOfficeFiles(sessionId)
        if (!disposed) setSnapshot(old => old?.sessionId === sessionId && old.workspaceId === workspaceId && old.files.length === files.length
          && old.files.every((file, index) => file === files[index]) ? old : { sessionId, workspaceId, files })
      } catch { /* Keep the last successful discovery during a transient connection failure. */ }
      finally { loading = false }
    }
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh() }, 10_000)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    const unsubscribe = window.electronAPI.onSessionEvent(event => {
      if (event.type === 'text_complete' && event.artifactVersions?.length
        || event.sessionId === sessionId && event.type === 'complete') void refresh()
    })
    const unsubscribeFiles = window.electronAPI.onSessionFilesChanged(changedId => { if (changedId === sessionId) void refresh() })
    const unsubscribeReconnect = window.electronAPI.onReconnected(onFocus)
    return () => {
      disposed = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      unsubscribe(); unsubscribeFiles(); unsubscribeReconnect()
    }
  }, [sessionId, workspaceId])
  return snapshot && snapshot.sessionId === sessionId && snapshot.workspaceId === workspaceId ? snapshot.files : emptyFiles
}
