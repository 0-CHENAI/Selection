import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WebsiteIcon } from '../markdown/WebsiteIcon'
import { useSourcesPanel } from './ResponseSourcesLayout'
import type { ResponseSource } from './response-sources'

export function ResponseSources({ sources, pending = false }: { sources: ResponseSource[]; pending?: boolean }) {
  const { t } = useTranslation()
  const openPanel = useSourcesPanel()
  if (!sources.length) return null
  const websites: ResponseSource[] = []
  const seenHosts = new Set<string>()
  for (const source of sources) {
    if (seenHosts.has(source.hostname)) continue
    seenHosts.add(source.hostname)
    websites.push(source)
    if (websites.length === 5) break
  }
  return (
    <div data-response-sources="" aria-hidden={pending || undefined} className="px-4 pb-3 transition-opacity duration-200 motion-reduce:transition-none" style={{ opacity: pending ? 0 : 1 }}>
      <button type="button" onClick={() => openPanel?.(sources)} disabled={pending || !openPanel} className="inline-flex items-center gap-2 rounded-lg bg-foreground/[0.04] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:bg-foreground/[0.08]">
        <BookOpen aria-hidden="true" className="size-4" />
        <span>{t('chat.sourcesLabel')}</span>
        <span aria-hidden="true" className="flex -space-x-1.5">
          {websites.map(source => <span key={source.hostname} className="flex size-6 items-center justify-center rounded-full bg-background text-base ring-2 ring-background [&>span]:mr-0"><WebsiteIcon href={source.url} /></span>)}
        </span>
        {t('chat.sourceCount', { count: sources.length })}
      </button>
    </div>
  )
}
