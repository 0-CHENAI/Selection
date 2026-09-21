import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WebsiteIcon } from '../markdown/WebsiteIcon'
import { useSourcesPanel } from './ResponseSourcesLayout'
import type { ResponseSource } from './response-sources'

export function ResponseSources({ sources }: { sources: ResponseSource[] }) {
  const { t } = useTranslation()
  const openPanel = useSourcesPanel()
  if (!sources.length) return null
  const websites = sources.filter((source, index) => sources.findIndex(other => other.hostname === source.hostname) === index).slice(0, 5)
  return (
    <>
      <div className="px-4 pb-3">

          <button type="button" onClick={() => openPanel?.(sources)} disabled={!openPanel} className="inline-flex items-center gap-2 rounded-lg bg-foreground/[0.04] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:bg-foreground/[0.08]">
            <BookOpen aria-hidden="true" className="size-4" />
            <span>{t('chat.sourcesLabel')}</span>
            <span aria-hidden="true" className="flex -space-x-1.5">
              {websites.map(source => <span key={source.hostname} className="flex size-6 items-center justify-center rounded-full bg-background text-base ring-2 ring-background [&>span]:mr-0"><WebsiteIcon href={source.url} /></span>)}
            </span>
            {t('chat.sourceCount', { count: sources.length })}
          </button>

      </div>
    </>
  )
}
