import * as React from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TaskApplyRunRevisionResult } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function canConfirmRunRevision(preview: TaskApplyRunRevisionResult | null): boolean {
  const hasChanges = Boolean(preview && (
    preview.diff.added.length > 0
    || preview.diff.removed.length > 0
    || preview.diff.changed.length > 0
  ))
  return Boolean(
    preview?.validation.valid
    && preview.yaml
    && preview.runRevision !== undefined
    && preview.runSpecHash
    && !preview.conflict
    && hasChanges,
  )
}

interface ApplyRunRevisionDialogProps {
  open: boolean
  preview: TaskApplyRunRevisionResult | null
  loading: boolean
  applying: boolean
  error: string | null
  hasUnsavedChanges: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

function DiffGroup({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">{label}</div>
      {values.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-[12px] text-foreground/75">
          {values.map((value) => <li key={value} className="truncate font-mono">{value}</li>)}
        </ul>
      ) : (
        <div className="mt-1 text-[12px] text-foreground/35">0</div>
      )}
    </div>
  )
}

export function ApplyRunRevisionDialog({
  open,
  preview,
  loading,
  applying,
  error,
  hasUnsavedChanges,
  onOpenChange,
  onConfirm,
}: ApplyRunRevisionDialogProps) {
  const { t } = useTranslation()
  const issues = preview ? [...preview.validation.errors, ...preview.validation.warnings] : []
  const canConfirm = canConfirmRunRevision(preview) && !loading && !applying

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!applying) onOpenChange(next) }}>
      <DialogContent className="max-h-[82vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{t('tasks.applyRevisionTitle')}</DialogTitle>
          <DialogDescription>{t('tasks.applyRevisionDescription')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-foreground/50">{t('tasks.revisionPreviewLoading')}</div>
        ) : preview ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 border-y border-border/70 py-3">
              <DiffGroup label={t('tasks.revisionAdded')} values={preview.diff.added} />
              <DiffGroup label={t('tasks.revisionRemoved')} values={preview.diff.removed} />
              <DiffGroup label={t('tasks.revisionChanged')} values={preview.diff.changed} />
            </div>

            {preview.diff.added.length === 0 && preview.diff.removed.length === 0 && preview.diff.changed.length === 0 && (
              <div role="note" className="text-[12px] text-foreground/55">{t('tasks.revisionNoChanges')}</div>
            )}

            <div>
              <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                {preview.validation.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
                )}
                {preview.validation.valid ? t('tasks.revisionValidationPassed') : t('tasks.revisionValidationFailed')}
              </div>
              {issues.length > 0 && (
                <ul className="mt-2 space-y-1 text-[12px]">
                  {issues.map((issue, index) => (
                    <li
                      key={`${issue.severity}:${issue.path}:${issue.message}:${index}`}
                      className={issue.severity === 'error' ? 'text-red-600 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}
                    >
                      <span className="font-mono">{issue.path}</span>: {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {hasUnsavedChanges && (
              <div role="note" className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-foreground/75">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                <span>{t('tasks.revisionUnsavedWarning')}</span>
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={applying}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={!canConfirm}>
            {applying ? t('tasks.revisionApplying') : t('tasks.revisionApplyConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
