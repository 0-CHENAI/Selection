import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PptPageIssue, PptPageProgress, PptRevision } from '@craft-agent/shared/protocol'

export function issueRevision(page: number, issue: PptPageIssue): PptRevision {
  return {
    action: 'revise',
    targets: [{ page, ...(issue.elementId ? { elementId: issue.elementId } : {}) }],
    comment: `Inspect the current deck and fix this diagnostic within the selected scope: ${issue.code}: ${issue.message}. Read the complete current check results before editing; preserve other pages and style.`,
  }
}

export function PptIssueRevisionPanel({ pages, total, onOpen, onApply, onCancel }: {
  pages: PptPageProgress[]
  total: number
  onOpen: (page: number) => void
  onApply: (text: string, revision: PptRevision) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(pages.find(page => page.issueCount > 0)?.index ?? 1)
  const [comment, setComment] = useState('')
  const page = pages.find(page => page.index === selected)
  const issues = page?.issues ?? (page?.issue ? [{ code: 'diagnostic', message: page.issue }] : [])
  const valid = Number.isInteger(selected) && selected > 0 && selected <= total
  return <section aria-label={t('ppt.result.revisePages')} data-testid="ppt-page-revision">
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm font-medium">{t('ppt.result.revisePages')}
        <select aria-label={t('ppt.result.selectPage')} className="ml-2 bg-background px-2 py-1 text-sm" value={selected} onChange={event => setSelected(Number(event.target.value))}>
          {Array.from({ length: total }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select>
      </label>
      <button type="button" disabled={!valid} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50" onClick={() => onOpen(selected)}>{t('ppt.result.previewPage')}</button>
    </div>
    {page?.name && <p className="mt-2 text-sm text-muted-foreground">{page.name}</p>}
    <ul className="mt-3 max-h-56 space-y-3 overflow-y-auto">
      {issues.map((issue, index) => <li key={`${issue.code}:${issue.elementId ?? ''}:${index}`} className="flex items-start gap-3 text-xs">
        <span className="min-w-0 flex-1 break-words">{issue.message}</span>
        <button type="button" disabled={!valid} className="shrink-0 text-primary hover:underline disabled:opacity-50" onClick={() => onApply(t('ppt.result.fixIssueRequest', { page: selected, issue: issue.message }), issueRevision(selected, issue))}>{t('ppt.result.fixIssue')}</button>
      </li>)}
    </ul>
    {!issues.length && <p className="mt-3 text-xs text-muted-foreground">{t('ppt.result.noListedIssues')}</p>}
    {(page?.issueCount ?? 0) > issues.length && <p className="mt-2 text-xs text-muted-foreground">{t('ppt.result.moreIssues', { count: page!.issueCount - issues.length })}</p>}
    <textarea aria-label={t('ppt.result.pageChange')} placeholder={t('ppt.result.pageChange')} maxLength={4000} value={comment} onChange={event => setComment(event.target.value)} className="mt-4 min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    <div className="mt-3 flex justify-end gap-4 text-xs">
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onCancel}>{t('common.cancel')}</button>
      <button type="button" disabled={!valid || !comment.trim()} className="text-primary hover:underline disabled:opacity-40" onClick={() => onApply(t('ppt.result.revisePageRequest', { page: selected, comment: comment.trim() }), { action: 'revise', targets: [{ page: selected }], comment: comment.trim() })}>{t('ppt.result.reviseThisPage')}</button>
    </div>
  </section>
}
