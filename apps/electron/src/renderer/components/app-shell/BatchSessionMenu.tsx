/** Context menu for the non-classification batch actions that remain. */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { useMenuComponents } from '@/components/ui/menu-context'
import { sendToWorkspaceAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/AppShellContext'
import { useSelectedIds, useSessionSelection } from '@/hooks/useSession'
import { hasTransferTargets } from './transfer-targets'

export interface BatchSessionMenuProps {
  onSendToWorkspace?: () => void
}

export function BatchSessionMenu({ onSendToWorkspace }: BatchSessionMenuProps = {}) {
  const { t } = useTranslation()
  const { MenuItem, Separator } = useMenuComponents()
  const selectedIds = useSelectedIds()
  const { clearMultiSelect } = useSessionSelection()
  const setSendToWorkspace = useSetAtom(sendToWorkspaceAtom)
  const { onDeleteSession, workspaces } = useAppShellContext()
  const canSendToWorkspace = hasTransferTargets(workspaces)

  const handleSendToWorkspace = useCallback(() => {
    if (onSendToWorkspace) onSendToWorkspace()
    else setSendToWorkspace([...selectedIds])
  }, [onSendToWorkspace, selectedIds, setSendToWorkspace])

  const handleBatchDelete = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    const firstDeleted = await onDeleteSession(ids[0])
    if (!firstDeleted) return
    for (let index = 1; index < ids.length; index++) {
      await onDeleteSession(ids[index], true)
    }
    clearMultiSelect()
    toast(`${ids.length} ${ids.length === 1 ? 'session' : 'sessions'} deleted`)
  }, [selectedIds, onDeleteSession, clearMultiSelect])

  return (
    <>
      <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
        {t('multiSelect.selected.session', { count: selectedIds.size })}
      </div>
      {canSendToWorkspace && <Separator />}

      {canSendToWorkspace && (
        <MenuItem onClick={handleSendToWorkspace}>
          <Send className="h-3.5 w-3.5" />
          <span className="flex-1">{t('sessionMenu.sendToWorkspace')}</span>
        </MenuItem>
      )}

      <Separator />
      <MenuItem onClick={handleBatchDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t('common.delete')}</span>
      </MenuItem>
    </>
  )
}
