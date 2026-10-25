import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PptChartFallback, PptPageStatus, PptRevision } from '@craft-agent/shared/protocol'
import type { Session } from '../../../shared/types'
import { usePptCatalog } from './usePptCatalog'
import { usePptRevisionSend } from './ppt-revision'

const STATUS_KEY: Record<PptPageStatus, 'ppt.result.passed' | 'ppt.result.needsRevision' | 'ppt.result.fixing' | 'ppt.result.pending'> = {
  passed: 'ppt.result.passed',
  needs_revision: 'ppt.result.needsRevision',
  fixing: 'ppt.result.fixing',
  pending: 'ppt.result.pending',
}

const REASON_KEY: Record<PptChartFallback['reason'], 'ppt.result.chartFallback.error' | 'ppt.result.chartFallback.missing' | 'ppt.result.chartFallback.timeout'> = {
  error: 'ppt.result.chartFallback.error',
  missing: 'ppt.result.chartFallback.missing',
  timeout: 'ppt.result.chartFallback.timeout',
}

const STATUS_CLASS: Record<PptPageStatus, string> = {
  passed: 'text-foreground/75 ring-border/70',
  needs_revision: 'text-destructive ring-destructive/30',
  fixing: 'text-accent ring-accent/30',
  pending: 'text-muted-foreground ring-border/60',
}

export function PptResultCard({ session }: { session: Session | null }) {
  const { t } = useTranslation()
  const send = usePptRevisionSend()
  const { catalog } = usePptCatalog()
  const [menu, setMenu] = useState<'restyle' | 'recolor' | null>(null)
  const progress = session?.pptProgress
  const generating = !!session?.isProcessing || !!progress?.generating
  const total = progress?.total ?? 0
  if (!session?.ppt || (!generating && total <= 0 && !progress?.fileName)) return null
  const current = progress?.current ?? Math.min(Math.max(total, 1), (progress?.completed ?? 0) + 1)
  const headline = total > 0
    ? generating
      ? t('ppt.result.progress', { current, total })
      : t('ppt.result.completed', { completed: progress?.completed ?? total, total })
    : generating
      ? t('ppt.result.generating')
      : ''
  const pages = progress?.pages ?? []
  const submit = (text: string, revision: PptRevision) => {
    setMenu(null)
    void send?.(text, revision)
  }
  return <div data-testid="ppt-result-card" className="mx-auto mb-2 flex w-full max-w-[720px] flex-col gap-2 rounded-xl bg-background px-3 py-2 shadow-minimal ring-1 ring-border/60">
    <div className="flex w-full flex-wrap items-center gap-2">
      {progress?.fileName && <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">{progress.fileName}</span>}
      {headline && <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{headline}</span>}
      {!generating && total > 0 && send && <>
        <button type="button" className="rounded-md px-2.5 py-1 text-[13px] hover:bg-foreground/5" onClick={() => setMenu(menu === 'restyle' ? null : 'restyle')}>{t('ppt.result.restyle')}</button>
        <button type="button" className="rounded-md px-2.5 py-1 text-[13px] hover:bg-foreground/5" onClick={() => setMenu(menu === 'recolor' ? null : 'recolor')}>{t('ppt.result.recolor')}</button>
      </>}
    </div>
    {pages.length > 0 && <ul className="flex w-full flex-wrap gap-1.5">
      {pages.map(page => <li key={`${page.index}-${page.id}`} data-testid="ppt-result-page" data-status={page.status} className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ring-1 ${STATUS_CLASS[page.status]}`}>
        <span className="tabular-nums">{page.index}</span>
        {page.name && <span className="max-w-[9rem] truncate">{page.name}</span>}
        <span>{t(STATUS_KEY[page.status])}</span>
      </li>)}
    </ul>}
    {progress?.chartFallbacks?.map((item, index) => <p key={`${item.skill}-${item.page ?? 'deck'}-${index}`} className="text-[12px] text-muted-foreground">{t('ppt.result.chartFallback', { where: item.page ? t('ppt.result.chartFallback.page', { page: item.page }) : '', skill: item.skill, reason: t(REASON_KEY[item.reason]) })}</p>)}
    {menu === 'restyle' && <div className="flex max-h-40 w-full flex-col overflow-auto rounded-md bg-foreground/[0.03] p-1">
      {catalog?.templates.map(template => <button key={template.id} type="button" className="truncate rounded px-2 py-1 text-left text-[12px] hover:bg-background" onClick={() => submit('换风格重排', { action: 'restyle', targets: [], templateId: template.id })}>{template.title}</button>)}
    </div>}
    {menu === 'recolor' && <div className="flex w-full flex-wrap gap-1.5 p-1">
      {catalog?.themes.map(theme => <button key={theme.id} type="button" className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] ring-1 ring-border hover:bg-foreground/5" onClick={() => submit('换配色', { action: 'recolor', targets: [], themeId: theme.id })}>
        <span className="size-3 rounded-full" style={{ background: theme.accent }} />{theme.name}
      </button>)}
    </div>}
  </div>
}
