import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useAppShellContext,
  usePendingCredential,
  usePendingPermission,
  useSession,
} from '@/context/AppShellContext'
import {
  ensureSessionMessagesLoadedAtom,
  loadedSessionsAtom,
  sessionMetaMapAtom,
} from '@/atoms/sessions'
import { deriveSessionMessagesLoadState } from '@/lib/session-load'
import { useGeneratedFileActions } from '@/hooks/useGeneratedFileActions'
import { resolveBackgroundTaskChipLabel } from './background-task-chip'
import type { Session } from '../../../shared/types'

export interface ChildSessionPreviewDialogProps {
  sessionId: string | null
  container: HTMLElement | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChildSessionPreviewDialog({
  sessionId,
  container,
  open,
  onOpenChange,
}: ChildSessionPreviewDialogProps) {
  const { t } = useTranslation()
  const previewFocus = React.useRef<{ content: HTMLElement; previous: HTMLElement | null } | null>(null)
  const session = useSession(sessionId ?? '')
  const sessionMeta = useAtomValue(sessionMetaMapAtom).get(sessionId ?? '')
  const title = sessionId
    ? resolveBackgroundTaskChipLabel({ taskId: sessionId, sessionName: session?.name ?? sessionMeta?.name })
    : t('chat.taskTypeAgent')

  return (
    <Dialog open={open && !!sessionId && !!container} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        overlay={false}
        portalContainer={container}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => {
          previewFocus.current = {
            content: event.target as HTMLElement,
            previous: document.activeElement instanceof HTMLElement ? document.activeElement : null,
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const focus = previewFocus.current
          if (focus?.previous?.isConnected && (document.activeElement === document.body || focus.content.contains(document.activeElement))) {
            focus.previous.focus()
          }
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="absolute inset-y-3 left-auto right-3 z-20 translate-x-0 translate-y-0 max-w-none sm:max-w-none w-[min(32rem,calc(100%-1.5rem))] p-0 gap-0 flex flex-col overflow-hidden data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-right-2 data-[state=closed]:slide-out-to-right-2"
      >
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="truncate pr-8 text-sm leading-6">{title}</DialogTitle>
          <DialogDescription className="sr-only">{t('chat.viewOutput')}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          {sessionId && <ChildSessionPreviewContent sessionId={sessionId} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Shared read-only output for the subagent window and individual background tasks. */
export function ChildSessionPreviewContent({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const {
    onOpenFile,
    onOpenUrl,
    onRespondToPermission,
    onRespondToCredential,
    workspaces,
  } = useAppShellContext()
  const session = useSession(sessionId)
  const sessionMeta = useAtomValue(sessionMetaMapAtom).get(sessionId)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const pendingPermission = usePendingPermission(sessionId)
  const pendingCredential = usePendingCredential(sessionId)

  React.useEffect(() => {
    void ensureMessagesLoaded(sessionId)
  }, [ensureMessagesLoaded, sessionId])

  const title = sessionId
    ? resolveBackgroundTaskChipLabel({
        taskId: sessionId,
        sessionName: session?.name ?? sessionMeta?.name,
      })
    : t('chat.taskTypeAgent')

  const displaySession = React.useMemo((): Session | null => {
    if (session) return session
    if (!sessionId || !sessionMeta) return null
    return {
      id: sessionMeta.id,
      workspaceId: sessionMeta.workspaceId,
      workspaceName: '',
      name: sessionMeta.name,
      preview: sessionMeta.preview,
      lastMessageAt: sessionMeta.lastMessageAt || 0,
      messages: [],
      isProcessing: sessionMeta.isProcessing || false,
      taskSlug: sessionMeta.taskSlug,
      taskNodeId: sessionMeta.taskNodeId,
      parentSessionId: sessionMeta.parentSessionId,
    }
  }, [session, sessionId, sessionMeta])

  const { openArtifact, openFile } = useGeneratedFileActions({
    sessionId: sessionId ?? undefined,
    workingDirectory: displaySession?.workingDirectory,
    sessionFolderPath: displaySession?.sessionFolderPath,
    workspaceRootPath: workspaces.find((workspace) => workspace.id === displaySession?.workspaceId)?.rootPath,
    onOpenFile,
  })

  const loadState = deriveSessionMessagesLoadState({
    session: displaySession,
    sessionMeta,
    messagesLoaded: !!sessionId && loadedSessions.has(sessionId),
  })

  return displaySession ? (
    <ChatDisplay
      key={displaySession.id}
      session={displaySession}
      onSendMessage={() => {}}
      onOpenFile={openFile}
      onOpenArtifact={openArtifact}
      onOpenUrl={onOpenUrl}
      currentModel={displaySession.model ?? ''}
      onModelChange={() => {}}
      pendingPermission={pendingPermission}
      onRespondToPermission={onRespondToPermission}
      pendingCredential={pendingCredential}
      onRespondToCredential={onRespondToCredential}
      compactMode
      disableSend
      hideComposer
      showRecordNavigation={false}
      enableFocusZone={false}
      messagesLoading={loadState.messagesLoading}
      emptyStateLabel={title}
    />
  ) : (
    <div className="h-full flex items-center justify-center text-sm text-foreground/60">
      {t('chat.sessionNoLongerExists')}
    </div>
  )
}
