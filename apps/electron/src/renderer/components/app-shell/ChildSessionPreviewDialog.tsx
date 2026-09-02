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
import { resolveBackgroundTaskChipLabel } from './background-task-chip'
import type { Session } from '../../../shared/types'

export interface ChildSessionPreviewDialogProps {
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChildSessionPreviewDialog({
  sessionId,
  open,
  onOpenChange,
}: ChildSessionPreviewDialogProps) {
  const { t } = useTranslation()
  const {
    onOpenFile,
    onOpenUrl,
    onRespondToPermission,
    onRespondToCredential,
  } = useAppShellContext()
  const session = useSession(sessionId ?? '')
  const sessionMeta = useAtomValue(sessionMetaMapAtom).get(sessionId ?? '')
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const pendingPermission = usePendingPermission(sessionId ?? '')
  const pendingCredential = usePendingCredential(sessionId ?? '')

  React.useEffect(() => {
    if (open && sessionId) void ensureMessagesLoaded(sessionId)
  }, [ensureMessagesLoaded, open, sessionId])

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
    }
  }, [session, sessionId, sessionMeta])

  const loadState = deriveSessionMessagesLoadState({
    session: displaySession,
    sessionMeta,
    messagesLoaded: !!sessionId && loadedSessions.has(sessionId),
  })

  return (
    <Dialog open={open && !!sessionId} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        overlay={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="left-auto right-6 top-[12%] translate-x-0 translate-y-0 sm:max-w-3xl w-[min(42rem,calc(100vw-3rem))] h-[min(70vh,720px)] p-0 gap-0 flex flex-col overflow-hidden"
      >
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="truncate pr-8">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('chat.viewOutput')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          {displaySession ? (
            <ChatDisplay
              key={displaySession.id}
              session={displaySession}
              onSendMessage={() => {}}
              onOpenFile={onOpenFile}
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
              enableFocusZone={false}
              messagesLoading={loadState.messagesLoading}
              emptyStateLabel={title}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {t('chat.sessionNoLongerExists')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
