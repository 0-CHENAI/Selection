import * as React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { UsersRound, X } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import {
  Dialog,
  DialogClose,
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
import { resolveNodeStatePill } from './kanban/node-state-pill'
import type { Session } from '../../../shared/types'

export interface ChildSessionPreviewDialogProps {
  sessionId: string | null
  container: HTMLElement | null
  open: boolean
  nodeState?: string
  onOpenChange: (open: boolean) => void
}

export function ChildSessionPreviewDialog({
  sessionId,
  container,
  open,
  nodeState,
  onOpenChange,
}: ChildSessionPreviewDialogProps) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const visible = open && !!sessionId && !!container
  const status = nodeState ? resolveNodeStatePill(nodeState) : null
  const previewFocus = React.useRef<{ content: HTMLElement; previous: HTMLElement | null } | null>(null)
  const session = useSession(sessionId ?? '')
  const sessionMeta = useAtomValue(sessionMetaMapAtom).get(sessionId ?? '')
  const title = sessionId
    ? resolveBackgroundTaskChipLabel({ taskId: sessionId, sessionName: session?.name ?? sessionMeta?.name })
    : t('chat.taskTypeAgent')

  return (
    <Dialog open={visible} onOpenChange={onOpenChange} modal={false}>
      {container && createPortal(
        <AnimatePresence>
          {visible && <motion.div
            key="child-preview-backdrop"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 bg-foreground/[0.06] dark:bg-black/25 backdrop-blur-[1.5px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
          />}
        </AnimatePresence>, container,
      )}
      <DialogContent
        overlay={false}
        showCloseButton={false}
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
        <DialogHeader className="relative px-6 py-5 border-b border-border/60 shrink-0 text-left">
          <div className="flex items-start gap-3 pr-8">
            <UsersRound className="mt-1 size-5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-6 [overflow-wrap:anywhere]">{title}</DialogTitle>
              {status?.labelKey && <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                {t(status.labelKey)}
              </span>}
            </div>
          </div>
          <DialogDescription className="sr-only">{t('chat.viewOutput')}</DialogDescription>
          <DialogClose className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-foreground/50 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{t('common.close')}</span>
          </DialogClose>
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
      taskPreview
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
