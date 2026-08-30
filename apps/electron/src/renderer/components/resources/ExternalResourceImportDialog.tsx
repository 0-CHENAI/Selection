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
import { Textarea } from '@/components/ui/textarea'
import type { ExternalImportAction } from '../../../shared/types'
import {
  beginMcpJsonImport,
  confirmSkillFileImport,
  type PreparedSkillFileImport,
} from './external-resource-import'

const MCP_JSON_PLACEHOLDER = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    }
  }
}`

interface ExternalResourceImportDialogProps {
  open: boolean
  workspaceId: string
  onOpenChange: (open: boolean) => void
}

export function ExternalResourceImportDialog({
  open,
  workspaceId,
  onOpenChange,
}: ExternalResourceImportDialogProps) {
  const { t } = useTranslation()
  const [mcpJson, setMcpJson] = useState('')
  const [mcpError, setMcpError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setMcpJson('')
    setMcpError(null)
  }, [open])

  const confirm = () => {
    setMcpError(null)
    let importPromise: ReturnType<typeof window.electronAPI.importMcpJson>
    try {
      importPromise = beginMcpJsonImport(
        window.electronAPI,
        workspaceId,
        mcpJson,
        () => onOpenChange(false),
      )
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error))
      return
    }

    void importPromise
      .then(result => {
        if (result.imported.length > 0) {
          toast.success(t('fileImport.mcpImported', { count: result.imported.length }))
        } else {
          toast.success(t('fileImport.skipped'))
        }
      })
      .catch(error => {
        toast.error(t('fileImport.mcpFailed'), {
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('fileImport.mcpTitle')}</DialogTitle>
          <DialogDescription className="sr-only">{t('fileImport.mcpTitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            autoFocus
            aria-label={t('fileImport.mcpTitle')}
            aria-invalid={Boolean(mcpError)}
            className="min-h-44 resize-y font-mono text-xs md:text-xs"
            placeholder={MCP_JSON_PLACEHOLDER}
            spellCheck={false}
            value={mcpJson}
            onChange={(event) => {
              setMcpJson(event.target.value)
              setMcpError(null)
            }}
          />
          {mcpError && <p role="alert" className="text-sm text-destructive">{mcpError}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={!mcpJson.trim()} onClick={confirm}>
            {t('fileImport.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SkillFileImportDialogProps {
  open: boolean
  workspaceId: string
  prepared: PreparedSkillFileImport
  onOpenChange: (open: boolean) => void
}

export function SkillFileImportDialog({
  open,
  workspaceId,
  prepared,
  onOpenChange,
}: SkillFileImportDialogProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<ExternalImportAction>(
    prepared.preview.conflict ? 'skip' : 'overwrite',
  )
  const [renameTo, setRenameTo] = useState('')

  const confirm = async () => {
    setLoading(true)
    try {
      const result = await confirmSkillFileImport(
        window.electronAPI,
        workspaceId,
        prepared,
        { action, renameTo: action === 'rename' ? renameTo.trim() : undefined },
      )
      if (result.status === 'imported') {
        toast.success(t('fileImport.skillImported', { slug: result.slug }))
      } else {
        toast.success(t('fileImport.skipped'))
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(t('fileImport.skillFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const preview = prepared.preview
  const canConfirm = action !== 'rename' || Boolean(renameTo.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('fileImport.skillTitle')}</DialogTitle>
          <DialogDescription>{t('fileImport.skillDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="font-medium">{preview.name}</div>
          <div className="text-muted-foreground">{preview.description}</div>
          <div className="text-muted-foreground">{preview.suggestedSlug}</div>
          {preview.conflict && <div className="text-warning">{t('fileImport.conflict')}</div>}
          <div className="text-muted-foreground">{preview.files.join(', ')}</div>
          <select
            aria-label={t('fileImport.confirm')}
            className="w-full rounded-[6px] bg-background px-2 py-1"
            value={action}
            onChange={event => setAction(event.target.value as ExternalImportAction)}
          >
            <option value="overwrite">{preview.conflict ? t('fileImport.overwrite') : t('fileImport.import')}</option>
            <option value="skip">{t('fileImport.skip')}</option>
            <option value="rename">{t('fileImport.rename')}</option>
          </select>
          {action === 'rename' && (
            <input
              aria-label={t('fileImport.rename')}
              className="w-full rounded-[6px] bg-background px-2 py-1"
              value={renameTo}
              onChange={event => setRenameTo(event.target.value)}
              placeholder={t('fileImport.renamePlaceholder')}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={loading} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={loading || !canConfirm} onClick={() => void confirm()}>
            {t('fileImport.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
