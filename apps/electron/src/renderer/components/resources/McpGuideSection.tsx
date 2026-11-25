import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpGuideMetadata } from '@craft-agent/shared/protocol'
import { canAutoFillMcpGuide, CLEARED_MCP_GUIDE, hasMeaningfulSourceGuide } from '@craft-agent/shared/sources/guide-content'
import { Info_Markdown, Info_Section } from '@/components/info'
import { Button } from '@/components/ui/button'
import { EditButton } from '@/components/ui/EditPopover'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

interface McpGuideSectionProps {
  workspaceId: string
  sourceId: string
  sourceSlug: string
  savedGuide: string | null
  guideMetadata: McpGuideMetadata | null
  onSaved: (markdown: string) => void
}

export function McpGuideSection({
  workspaceId, sourceId, sourceSlug, savedGuide, guideMetadata, onSaved,
}: McpGuideSectionProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const [pending, setPending] = useState<'generate' | 'save' | null>(null)
  const [message, setMessage] = useState<'drafted' | 'generateFailed' | 'saveFailed' | 'conflict' | null>(null)
  const request = useRef(0)

  const open = () => {
    setPrevious(savedGuide)
    setDraft(savedGuide === CLEARED_MCP_GUIDE || canAutoFillMcpGuide(savedGuide) ? '' : savedGuide ?? '')
    setMessage(null)
  }

  const close = () => {
    if (pending === 'save') return
    request.current++
    setDraft(null)
    setPending(null)
  }

  const generate = async () => {
    if (!guideMetadata || draft === null || pending) return
    const generation = ++request.current
    setPending('generate')
    setMessage(null)
    try {
      const markdown = await window.electronAPI.draftMcpGuide(workspaceId, sourceSlug, guideMetadata, draft)
      if (generation !== request.current) return
      setDraft(markdown)
      setMessage('drafted')
    } catch {
      if (generation === request.current) setMessage('generateFailed')
    } finally {
      if (generation === request.current) setPending(null)
    }
  }

  const save = async () => {
    if (draft === null || pending) return
    setPending('save')
    setMessage(null)
    try {
      const saved = await window.electronAPI.saveMcpGuide(workspaceId, sourceSlug, { sourceId, previous, markdown: draft })
      if (saved === null) {
        setMessage('conflict')
        return
      }
      onSaved(saved)
      setDraft(null)
    } catch {
      setMessage('saveFailed')
    } finally {
      setPending(null)
    }
  }

  const feedback = {
    drafted: t('sourceInfo.guideDrafted'),
    generateFailed: t('sourceInfo.guideGenerateFailed'),
    saveFailed: t('sourceInfo.guideSaveFailed'),
    conflict: t('sourceInfo.guideConflict'),
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(next) => next ? open() : close()}>
      <Info_Section
        title={t('sourceInfo.documentation')}
        description={t('sourceInfo.documentationDesc')}
        actions={<DialogTrigger asChild><EditButton /></DialogTrigger>}
      >
        {savedGuide && hasMeaningfulSourceGuide(savedGuide) ? (
          <Info_Markdown maxHeight={540} fullscreen>{savedGuide}</Info_Markdown>
        ) : (
          <p className="px-6 pb-3 text-sm text-muted-foreground">{t('sourceInfo.guideEmpty')}</p>
        )}
      </Info_Section>
      <DialogContent className="sm:max-w-2xl" showCloseButton={pending !== 'save'}>
        <DialogHeader>
          <DialogTitle>{t('sourceInfo.documentation')}</DialogTitle>
          <DialogDescription>{t('sourceInfo.documentationDesc')}</DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label={t('sourceInfo.documentation')}
          className="min-h-48 max-h-[45vh] resize-y font-mono text-sm"
          value={draft ?? ''}
          spellCheck={false}
          readOnly={Boolean(pending)}
          onChange={(event) => {
            setDraft(event.target.value)
            if (message !== 'conflict') setMessage(null)
          }}
        />
        {message && (
          <p role={message === 'drafted' ? 'status' : 'alert'} className="text-sm text-muted-foreground">
            {feedback[message]}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            className="sm:mr-auto"
            disabled={Boolean(pending) || message === 'conflict' || !(guideMetadata?.instructions || guideMetadata?.tools.length)}
            onClick={generate}
          >
            {pending === 'generate' ? t('common.loading') : t('sourceInfo.guideGenerate')}
          </Button>
          <Button variant="ghost" disabled={pending === 'save'} onClick={close}>{t('common.cancel')}</Button>
          <Button disabled={Boolean(pending) || message === 'conflict'} onClick={save}>
            {pending === 'save' ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
