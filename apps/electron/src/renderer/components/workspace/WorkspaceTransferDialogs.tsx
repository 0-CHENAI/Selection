/**
 * WorkspaceTransferDialogs — Export / import an entire workspace as a bundle file.
 *
 * ExportWorkspaceDialog: confirm the export scope (sessions are opt-in), call
 * exportWorkspaceBundle, then write the JSON via the native save dialog
 * (file:saveDialog). Credentials are stripped by the exporter.
 *
 * ImportWorkspaceDialog: shows a bundle summary with an optional rename, then
 * calls importWorkspaceBundle — the handler runs full bundle validation and
 * always creates a NEW workspace (never merges).
 */

import * as React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRegisterModal } from '@/context/ModalContext'
import type { WorkspaceBundle } from '../../../shared/types'

// ============================================================
// Export
// ============================================================

export interface ExportWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null
}

export function ExportWorkspaceDialog({ open, onOpenChange, workspaceId }: ExportWorkspaceDialogProps) {
  const { t } = useTranslation()
  const [includeSessions, setIncludeSessions] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Register with modal context so X button / Cmd+W closes this dialog first
  useRegisterModal(open, () => {
    if (!isExporting) onOpenChange(false)
  })

  // Reset transient state each time the dialog opens
  useEffect(() => {
    if (!open) return
    setIncludeSessions(false)
    setIsExporting(false)
  }, [open])

  const handleExport = useCallback(async () => {
    if (!workspaceId || !window.electronAPI) return

    setIsExporting(true)
    const toastId = toast.loading(t('workspaceTransfer.exporting'))
    try {
      const { bundle, warnings } = await window.electronAPI.exportWorkspaceBundle(workspaceId, { includeSessions })

      const saveResult = await window.electronAPI.saveFileDialog({
        title: t('workspaceTransfer.exportTitle'),
        defaultPath: `${bundle.config.slug || 'workspace'}-workspace.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        content: JSON.stringify(bundle, null, 2),
      })

      if (saveResult.canceled) {
        toast.dismiss(toastId)
        return // keep the dialog open so the user can retry
      }

      toast.success(t('workspaceTransfer.exported'), {
        id: toastId,
        description: saveResult.filePath,
      })
      if (warnings.length > 0) {
        toast.warning(t('workspaceTransfer.exportWarnings', { count: warnings.length }), {
          description: warnings.join('\n'),
        })
      }
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(t('workspaceTransfer.exportFailed'), { id: toastId, description: message })
    } finally {
      setIsExporting(false)
    }
  }, [workspaceId, includeSessions, onOpenChange, t])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isExporting) {
        onOpenChange(isOpen)
      }
    }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            {t('workspaceTransfer.exportTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('workspaceTransfer.exportDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 px-1 pt-1 border-t border-border/50">
          <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeSessions}
              disabled={isExporting}
              onChange={(e) => setIncludeSessions(e.target.checked)}
            />
            <span>{t('workspaceTransfer.includeSessions')}</span>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? t('workspaceTransfer.exporting') : t('workspaceTransfer.exportBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Import
// ============================================================

export interface ImportWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bundle: WorkspaceBundle | null
  onImported?: () => void
}

export function ImportWorkspaceDialog({ open, onOpenChange, bundle, onImported }: ImportWorkspaceDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  // Register with modal context so X button / Cmd+W closes this dialog first
  useRegisterModal(open, () => {
    if (!isImporting) onOpenChange(false)
  })

  // Reset transient state each time the dialog opens
  useEffect(() => {
    if (!open) return
    setName(bundle?.config.name ?? '')
    setIsImporting(false)
  }, [open, bundle])

  const handleImport = useCallback(async () => {
    if (!bundle || !window.electronAPI) return

    setIsImporting(true)
    const toastId = toast.loading(t('workspaceTransfer.importing'))
    try {
      const result = await window.electronAPI.importWorkspaceBundle(bundle, { name: name.trim() || undefined })

      const sources = result.resources.sources.imported.length
      const skills = result.resources.skills.imported.length
      const automations = result.resources.automations.imported.length
      const sessions = result.sessions.imported.length
      const failed =
        result.resources.sources.failed.length +
        result.resources.skills.failed.length +
        result.resources.automations.failed.length +
        result.sessions.failed.length

      toast.success(t('workspaceTransfer.imported', { name: result.workspace.name }), {
        id: toastId,
        description:
          t('workspaceTransfer.importResultSummary', { sources, skills, automations, sessions }) +
          (failed > 0 ? ` — ${t('workspaceTransfer.importFailedCount', { count: failed })}` : ''),
      })
      // Credentials are stripped on export — the new workspace needs re-auth
      if (sources > 0) {
        toast.info(t('workspaceTransfer.credentialsNote'))
      }
      onOpenChange(false)
      onImported?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(t('workspaceTransfer.importFailed'), { id: toastId, description: message })
    } finally {
      setIsImporting(false)
    }
  }, [bundle, name, onOpenChange, onImported, t])

  const counts = bundle
    ? {
        sources: bundle.resources.sources?.length ?? 0,
        skills: bundle.resources.skills?.length ?? 0,
        automations: bundle.resources.automations?.length ?? 0,
        sessions: bundle.sessions?.length ?? 0,
      }
    : null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isImporting) {
        onOpenChange(isOpen)
      }
    }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t('workspaceTransfer.importTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('workspaceTransfer.importDescription')}
          </DialogDescription>
        </DialogHeader>

        {bundle && counts && (
          <div className="flex flex-col gap-3 py-1">
            <div className="rounded-md bg-foreground/[0.03] px-3 py-2 text-xs space-y-1">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('workspaceTransfer.summaryName')}</span>
                <span className="truncate">{bundle.config.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('workspaceTransfer.summaryExportedAt')}</span>
                <span>{new Date(bundle.exportedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">{t('workspaceTransfer.summaryContents')}</span>
                <span className="text-right">{t('workspaceTransfer.summaryCounts', counts)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">{t('workspaceTransfer.nameLabel')}</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={bundle.config.name}
                disabled={isImporting}
              />
            </div>

            <p className="text-[11px] text-muted-foreground/80 leading-snug">
              {t('workspaceTransfer.credentialsNote')}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={handleImport} disabled={!bundle || isImporting}>
            {isImporting ? t('workspaceTransfer.importing') : t('workspaceTransfer.importBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
