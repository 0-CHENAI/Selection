import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@craft-agent/ui'
import { Button } from '@/components/ui/button'
import type { ThoughtNode, ThoughtVersion } from '@craft-agent/shared/thought-workbench/types'

/** Browsing a receipt is read-only; applying an answer never restores old input. */
export function ThoughtAnswerHistory({ node, disabled, onApply }: {
  node: ThoughtNode
  disabled: boolean
  onApply: (version: ThoughtVersion) => void
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = React.useState<string>()
  const version = node.versions.find(item => item.id === selectedId) ?? node.versions.at(-1)
  const [expanded, setExpanded] = React.useState(false)
  if (!version) return null
  return <details onToggle={event => setExpanded(event.currentTarget.open)} className="space-y-2 border-t pt-3">
    <summary className="cursor-pointer text-sm">{t('thought.versions')} ({node.versions.length}){node.versions.at(-1)?.id !== node.activeVersionId && <span role="status" className="mt-1 block text-xs text-muted-foreground">{t('thought.answerInHistory')}</span>}</summary>
    {expanded && <>
      <select aria-label={t('thought.versions')} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={version.id} onChange={event => setSelectedId(event.target.value)}>
        {node.versions.map((item, index) => <option key={item.id} value={item.id}>{index + 1} · {item.origin === 'manual' ? t('thought.reviseAnswer') : item.model} · {item.createdAt}</option>)}
      </select>
      <div className="space-y-1 text-sm"><p className="font-medium">{t('thought.question')}</p><p className="whitespace-pre-wrap break-words">{version.question}</p></div>
      <Markdown>{version.answer}</Markdown>
      <Button variant="outline" disabled={disabled || node.activeVersionId === version.id} onClick={() => onApply(version)}>{t('common.apply')}</Button>
    </>}
  </details>
}
