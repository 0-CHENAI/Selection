import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ExternalImportAction, McpImportCandidate, SkillImportPreview } from '../../../shared/types'

type Kind = 'mcp' | 'skill'

interface ExternalResourceImportDialogProps {
  open: boolean
  kind: Kind
  workspaceId: string
  onOpenChange: (open: boolean) => void
}

export function ExternalResourceImportDialog({
  open,
  kind,
  workspaceId,
  onOpenChange,
}: ExternalResourceImportDialogProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [mcpCandidates, setMcpCandidates] = useState<McpImportCandidate[] | null>(null)
  const [mcpActions, setMcpActions] = useState<Record<string, ExternalImportAction>>({})
  const [mcpRenames, setMcpRenames] = useState<Record<string, string>>({})
  const [skillPayload, setSkillPayload] = useState<
    { kind: 'markdown'; content: string } | { kind: 'zip'; zipBase64: string } | null
  >(null)
  const [skillPreview, setSkillPreview] = useState<SkillImportPreview | null>(null)
  const [skillAction, setSkillAction] = useState<ExternalImportAction>('overwrite')
  const [skillRename, setSkillRename] = useState('')

  const reset = () => {
    setMcpCandidates(null)
    setMcpActions({})
    setMcpRenames({})
    setSkillPayload(null)
    setSkillPreview(null)
    setSkillAction('overwrite')
    setSkillRename('')
  }

  useEffect(() => {
    if (!open) {
      reset()
      return
    }
    let cancelled = false
    const pick = async () => {
      setLoading(true)
      try {
        if (kind === 'mcp') {
          const picked = await window.electronAPI.openMcpJsonFile()
          if (cancelled) return
          if (picked.canceled || !picked.text) {
            onOpenChange(false)
            return
          }
          const candidates = await window.electronAPI.previewMcpJsonImport(workspaceId, picked.text)
          if (cancelled) return
          setMcpCandidates(candidates)
          setMcpActions(Object.fromEntries(candidates.map(item => [item.key, item.conflict ? 'skip' : 'overwrite'])))
        } else {
          const picked = await window.electronAPI.openSkillImportFile()
          if (cancelled) return
          if (picked.canceled) {
            onOpenChange(false)
            return
          }
          const payload = picked.kind === 'zip'
            ? { kind: 'zip' as const, zipBase64: picked.zipBase64 }
            : { kind: 'markdown' as const, content: picked.content }
          const preview = await window.electronAPI.previewSkillFileImport(workspaceId, payload)
          if (cancelled) return
          setSkillPayload(payload)
          setSkillPreview(preview)
          setSkillAction(preview.conflict ? 'skip' : 'overwrite')
        }
      } catch (error) {
        toast.error(kind === 'mcp' ? t('fileImport.mcpFailed') : t('fileImport.skillFailed'), {
          description: error instanceof Error ? error.message : String(error),
        })
        onOpenChange(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void pick()
    return () => {
      cancelled = true
    }
  }, [kind, onOpenChange, open, t, workspaceId])

  const confirm = async () => {
    setLoading(true)
    try {
      if (kind === 'mcp' && mcpCandidates) {
        const result = await window.electronAPI.importMcpJson(
          workspaceId,
          mcpCandidates,
          mcpCandidates.map(item => ({
            key: item.key,
            action: mcpActions[item.key] ?? 'skip',
            renameTo: mcpRenames[item.key],
          })),
        )
        toast.success(t('fileImport.mcpImported', { count: result.imported.length }))
      } else if (kind === 'skill' && skillPayload) {
        const result = await window.electronAPI.importSkillFile(workspaceId, skillPayload, {
          action: skillAction,
          renameTo: skillRename || undefined,
        })
        if (result.skipped) toast.success(t('fileImport.skipped'))
        else toast.success(t('fileImport.skillImported', { slug: result.slug }))
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(kind === 'mcp' ? t('fileImport.mcpFailed') : t('fileImport.skillFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const ready = kind === 'mcp' ? Boolean(mcpCandidates?.length) : Boolean(skillPreview)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!loading) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === 'mcp' ? t('fileImport.mcpTitle') : t('fileImport.skillTitle')}</DialogTitle>
          <DialogDescription>
            {kind === 'mcp' ? t('fileImport.mcpDescription') : t('fileImport.skillDescription')}
          </DialogDescription>
        </DialogHeader>
        {kind === 'mcp' && mcpCandidates && (
          <div className="max-h-72 space-y-3 overflow-y-auto text-sm">
            {mcpCandidates.map(item => (
              <div key={item.key} className="rounded-[8px] bg-muted/40 p-3 space-y-1">
                <div className="font-medium">{item.name}</div>
                <div className="text-muted-foreground">{item.mcp.transport} · {item.suggestedSlug}</div>
                {item.needsAuth && <div className="text-warning">{t('fileImport.needsAuth')}</div>}
                {item.redactions.length > 0 && (
                  <div className="text-muted-foreground">{t('fileImport.strippedSecrets', { count: item.redactions.length })}</div>
                )}
                {item.cwdDropped && <div className="text-muted-foreground">{t('fileImport.cwdDropped')}</div>}
                {item.conflict && <div className="text-warning">{t('fileImport.conflict')}</div>}
                <select
                  className="mt-1 w-full rounded-[6px] bg-background px-2 py-1"
                  value={mcpActions[item.key]}
                  onChange={event => setMcpActions(current => ({ ...current, [item.key]: event.target.value as ExternalImportAction }))}
                >
                  <option value="overwrite">{item.conflict ? t('fileImport.overwrite') : t('fileImport.import')}</option>
                  <option value="skip">{t('fileImport.skip')}</option>
                  <option value="rename">{t('fileImport.rename')}</option>
                </select>
                {mcpActions[item.key] === 'rename' && (
                  <input
                    className="w-full rounded-[6px] bg-background px-2 py-1"
                    value={mcpRenames[item.key] ?? ''}
                    onChange={event => setMcpRenames(current => ({ ...current, [item.key]: event.target.value }))}
                    placeholder={t('fileImport.renamePlaceholder')}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {kind === 'skill' && skillPreview && (
          <div className="space-y-2 text-sm">
            <div className="font-medium">{skillPreview.name}</div>
            <div className="text-muted-foreground">{skillPreview.description}</div>
            <div className="text-muted-foreground">{skillPreview.suggestedSlug}</div>
            {skillPreview.conflict && <div className="text-warning">{t('fileImport.conflict')}</div>}
            <div className="text-muted-foreground">{skillPreview.files.join(', ')}</div>
            <select
              className="w-full rounded-[6px] bg-background px-2 py-1"
              value={skillAction}
              onChange={event => setSkillAction(event.target.value as ExternalImportAction)}
            >
              <option value="overwrite">{skillPreview.conflict ? t('fileImport.overwrite') : t('fileImport.import')}</option>
              <option value="skip">{t('fileImport.skip')}</option>
              <option value="rename">{t('fileImport.rename')}</option>
            </select>
            {skillAction === 'rename' && (
              <input
                className="w-full rounded-[6px] bg-background px-2 py-1"
                value={skillRename}
                onChange={event => setSkillRename(event.target.value)}
                placeholder={t('fileImport.renamePlaceholder')}
              />
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={loading} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={loading || !ready} onClick={() => void confirm()}>{t('fileImport.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
