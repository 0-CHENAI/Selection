import * as React from 'react'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { FreeFormInput } from '@/components/app-shell/input/FreeFormInput'
import { NewSessionBrand } from '@/components/app-shell/NewSessionBrand'
import { CHAT_CLASSES } from '@/config/layout'
import { createDraftSubmission } from '@/lib/draft-session'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'

/** Local composer; create a persistent session only when submitting. */
export function DraftChatPage() {
  const { activeWorkspaceId, orchestrationProjectId, onCreateSession, onSendMessage,
    llmConnections, workspaceDefaultLlmConnection, enabledSources, skills } = useAppShellContext()
  const initial = llmConnections.find(c => c.slug === workspaceDefaultLlmConnection)
    ?? llmConnections.find(c => c.isDefault) ?? llmConnections[0]
  const [connection, setConnection] = React.useState(initial?.slug)
  const [model, setModel] = React.useState(initial?.defaultModel ?? '')
  const [busy, setBusy] = React.useState(false)
  const options = React.useRef({ model, connection })
  options.current = { model, connection }
  const [submit] = React.useState(() => createDraftSubmission(() => onCreateSession(activeWorkspaceId!, {
    projectId: orchestrationProjectId ?? undefined,
    model: options.current.model || undefined,
    llmConnection: options.current.connection,
  })))
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return <div className="h-full flex flex-col relative">
    <div className={CHAT_CLASSES.recordRailGrid}>
      <div className={CHAT_CLASSES.recordRailContent}>
        <div className="relative flex-1"><NewSessionBrand /></div>
        <div className={cn(CHAT_CLASSES.composerColumn, 'mt-1 px-5 pb-4')}>
          <FreeFormInput currentModel={model}
            onModelChange={(value, slug) => { setModel(value); if (slug) setConnection(slug) }}
            workspaceId={activeWorkspaceId ?? undefined} sources={enabledSources} skills={skills}
            isEmptySession disabled={busy}
            onSubmit={async (message, attachments, skillSlugs) => {
              if (!activeWorkspaceId) return false
              setBusy(true)
              try {
                return await submit(session => {
                  onSendMessage(session.id, message, attachments, skillSlugs)
                  if (mounted.current) navigate(routes.view.allSessions(session.id))
                })
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error))
                return false
              } finally {
                if (mounted.current) setBusy(false)
              }
            }} />
        </div>
      </div>
    </div>
  </div>
}
