import { useTranslation } from 'react-i18next'
import type { ThoughtGeneration } from '@craft-agent/shared/thought-workbench/types'

/** Untrusted live text stays separate from the node's committed answer. */
export function ThoughtGenerationOutput({ generation }: { generation: ThoughtGeneration }) {
  const { t } = useTranslation()
  return <>
    {generation.processText && <details className="space-y-2 border-t pt-3">
      <summary className="cursor-pointer text-sm">{t('thought.agentProgress')}</summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{generation.processText}</pre>
    </details>}
    {generation.preview && <section aria-label={t('overlay.preview')} className="space-y-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">{t('overlay.preview')}</p>
      <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{generation.preview}</div>
    </section>}
  </>
}
