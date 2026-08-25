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
import { beginMcpJsonImport } from './external-resource-import'

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
