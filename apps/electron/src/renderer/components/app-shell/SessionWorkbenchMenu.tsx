import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { useMenuComponents } from '@/components/ui/menu-context'
import type { SessionMeta } from '@/atoms/sessions'
import { isThoughtWorkbenchEnabled } from '@craft-agent/shared/feature-flags'
import { newThoughtDocument, type ThoughtDocument } from '@craft-agent/shared/thought-workbench/types'

/** Load drafts only when this submenu opens, not once per session-list row. */
export function useSessionWorkbenchImport(item: SessionMeta) {
  const { t } = useTranslation()
  const [documents, setDocuments] = React.useState<ThoughtDocument[]>([])
  const [loading, setLoading] = React.useState(false)
  const importing = React.useRef(false)
  const identity = React.useRef(`${item.workspaceId}:${item.id}`)
  identity.current = `${item.workspaceId}:${item.id}`
  async function load() {
    setLoading(true)
    const expected = identity.current
    try {
      const result = await window.electronAPI.thoughtWorkbench(item.workspaceId, { action: 'list' })
      if (identity.current === expected) setDocuments((result.documents ?? []).filter(document => !document.archived))
    } catch (error) { toast.error(t('thought.importFailed'), { description: String(error) }) }
    finally { setLoading(false) }
  }
  async function add(document?: ThoughtDocument): Promise<boolean> {
    if (importing.current) return false
    importing.current = true
    try {
      let target = document
      if (!target) {
        const result = await window.electronAPI.thoughtWorkbench(item.workspaceId, { action: 'save', expectedRevision: 0,
          document: { ...newThoughtDocument(crypto.randomUUID()), title: item.name || item.preview || t('thought.newDraft') } })
        target = result.document ?? undefined
      }
      if (!target) throw new Error(t('thought.importFailed'))
      await window.electronAPI.thoughtWorkbench(item.workspaceId, { action: 'importSession', id: target.id, expectedRevision: target.revision, sessionId: item.id })
      toast.success(t('thought.imported'), { description: target.title })
      return true
    } catch (error) { toast.error(t('thought.importFailed'), { description: String(error) }); return false }
    finally { importing.current = false }
  }
  return { documents, loading, load, add }
}

export function SessionWorkbenchMenu({ item }: { item: SessionMeta }) {
  const { t } = useTranslation()
  const { MenuItem, Sub, SubTrigger, SubContent, Separator } = useMenuComponents()
  const { documents, loading, load, add } = useSessionWorkbenchImport(item)
  if (!isThoughtWorkbenchEnabled()) return null
  return <Sub onOpenChange={open => { if (open) void load() }}>
    <SubTrigger><GitBranch className="h-3.5 w-3.5" /><span className="flex-1">{t('thought.addSession')}</span></SubTrigger>
    <SubContent className="max-h-80 overflow-y-auto">
      <MenuItem onClick={() => void add()}>{t('thought.newDraft')}</MenuItem><Separator />
      {loading ? <MenuItem disabled>{t('common.loading')}</MenuItem> : documents.map(document => <MenuItem key={document.id} onClick={() => void add(document)}>{document.title || t('thought.newDraft')}</MenuItem>)}
    </SubContent>
  </Sub>
}
