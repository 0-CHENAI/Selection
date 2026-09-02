/** Shared session menu after the classification workflow removal (#180). */
import { useTranslation } from 'react-i18next'
import {
  AppWindow,
  Check,
  Columns2,
  Copy,
  FolderKanban,
  FolderOpen,
  MailOpen,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'

import { useMenuComponents } from '@/components/ui/menu-context'
import { getFileManagerName } from '@/lib/platform'
import type { SessionMeta } from '@/atoms/sessions'
import { hasMessagesMeta, hasUnreadMeta } from '@/utils/session'
import { MessagingSessionMenuItem } from '@/components/messaging/MessagingSessionMenuItem'
import { useSessionMenuActions } from '@/hooks/useSessionMenuActions'

export interface SessionMenuProjectOption {
  id: string
  slug: string
  name: string
}

export interface SessionMenuProps {
  item: SessionMeta
  hasTransferTargets?: boolean
  projects?: SessionMenuProjectOption[]
  onSetProjectId?: (projectId: string | null) => void
  onRename: () => void
  onMarkUnread: () => void
  onOpenInNewWindow: () => void
  onSendToWorkspace?: () => void
  onDelete: () => void
}

export function SessionMenu({
  item,
  onRename,
  onMarkUnread,
  onOpenInNewWindow,
  onSendToWorkspace,
  onDelete,
  hasTransferTargets,
  projects = [],
  onSetProjectId,
}: SessionMenuProps) {
  const { t } = useTranslation()
  const actions = useSessionMenuActions({ item })
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()
  const showMarkUnread = !hasUnreadMeta(item) && hasMessagesMeta(item)

  return (
    <>
      {hasTransferTargets && onSendToWorkspace && (
        <MenuItem onClick={onSendToWorkspace}>
          <Send className="h-3.5 w-3.5" />
          <span className="flex-1">{t('sessionMenu.sendToWorkspace')}</span>
        </MenuItem>
      )}

      <MessagingSessionMenuItem sessionId={item.id} />
      <Separator />

      {projects.length > 0 && onSetProjectId && (
        <Sub>
          <SubTrigger className="pr-2">
            <FolderKanban className="h-3.5 w-3.5" />
            <span className="flex-1">{t('sessionMenu.projects')}</span>
          </SubTrigger>
          <SubContent>
            <MenuItem onClick={() => onSetProjectId(null)}>
              {!item.projectId && <Check className="h-3.5 w-3.5" />}
              <span className={item.projectId ? 'flex-1 ml-[18px]' : 'flex-1'}>
                {t('sessionMenu.noProject')}
              </span>
            </MenuItem>
            <Separator />
            {projects.map(project => {
              const isBound = item.projectId === project.id
              return (
                <MenuItem key={project.id} onClick={() => onSetProjectId(project.id)}>
                  {isBound && <Check className="h-3.5 w-3.5" />}
                  <span className={isBound ? 'flex-1' : 'flex-1 ml-[18px]'}>{project.name}</span>
                </MenuItem>
              )
            })}
          </SubContent>
        </Sub>
      )}

      {showMarkUnread && (
        <MenuItem onClick={onMarkUnread}>
          <MailOpen className="h-3.5 w-3.5" />
          <span className="flex-1">{t('sessionMenu.markAsUnread')}</span>
        </MenuItem>
      )}

      <Separator />
      <MenuItem onClick={onRename}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">{t('common.rename')}</span>
      </MenuItem>
      <MenuItem onClick={actions.refreshTitle}>
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.regenerateTitle')}</span>
      </MenuItem>

      <Separator />
      <MenuItem onClick={actions.openInNewPanel}>
        <Columns2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.openInNewPanel')}</span>
      </MenuItem>
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.openInNewWindow')}</span>
      </MenuItem>
      <MenuItem onClick={actions.showInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}</span>
      </MenuItem>
      <MenuItem onClick={actions.copyPath}>
        <Copy className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.copyPath')}</span>
      </MenuItem>

      <Separator />
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t('common.delete')}</span>
      </MenuItem>
    </>
  )
}
