import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { ResearchConfig } from '@craft-agent/shared/tasks/research'
import { Button } from '@/components/ui/button'

export function ResearchConfiguration({ value, disabled, onChange }: { value: ResearchConfig; disabled?: boolean; onChange: (value: ResearchConfig) => void }) {
  const { t } = useTranslation()
  const fieldClass = 'w-full min-w-0 rounded-md border border-border bg-background p-2 text-xs'
  return <details open className="min-w-0 rounded-lg border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">{t('tasks.research.title')}</summary>
    <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-3 disabled:opacity-60">
      <p className="text-xs text-muted-foreground">{t('tasks.research.configHint')}</p>
      {!!value.lines?.length && <p className="text-xs font-medium">{t('tasks.research.lines')}: {value.line.id}</p>}
      <label className="block space-y-1 text-xs">{t('tasks.research.question')}<textarea className={fieldClass} rows={2} value={value.line.question} onChange={event => onChange({ ...value, line: { ...value.line, question: event.target.value } })} /></label>
      <label className="block space-y-1 text-xs">{t('tasks.research.premises')}<textarea className={fieldClass} rows={2} value={value.line.premises.join('\n')} onChange={event => onChange({ ...value, line: { ...value.line, premises: event.target.value.split('\n').filter(line => line.trim()) } })} /></label>
      <div className="space-y-2">
        <p className="text-xs font-medium">{t('tasks.research.lines')}</p>
        {(value.lines ?? []).map((line,index) => <div key={line.id} className="space-y-2 rounded-md border border-border p-2">
          <p className="text-xs font-medium">{line.id}</p>
          <label className="block space-y-1 text-xs">{t('tasks.research.question')}<textarea className={fieldClass} value={line.question} onChange={event => onChange({...value,lines:value.lines!.map((item,position) => position===index ? {...item,question:event.target.value} : item)})} /></label>
          <label className="block space-y-1 text-xs">{t('tasks.research.premises')}<textarea className={fieldClass} value={line.premises.join('\n')} onChange={event => onChange({...value,lines:value.lines!.map((item,position) => position===index ? {...item,premises:event.target.value.split('\n').filter(line => line.trim())} : item)})} /></label>
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange({...value,lines:value.lines!.filter((_,position) => position!==index)})}>{t('tasks.research.remove')}</Button>
        </div>)}
        <Button type="button" size="sm" variant="outline" onClick={() => { const ids=new Set([value.line.id,...(value.lines ?? []).map(line => line.id)]);let index=2;while(ids.has(`line-${index}`))index++;onChange({...value,lines:[...(value.lines ?? []),{id:`line-${index}`,question:value.line.question,premises:[],parentLineIds:[value.line.id]}]}) }}>{t('tasks.research.addLine')}</Button>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium">{t('tasks.research.dimensions')}</p>
        {value.dimensions.map((dimension, index) => <div key={index} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-2">
          <input aria-label={`${t('tasks.research.dimensionId')} ${index + 1}`} className={fieldClass} value={dimension.id} onChange={event => onChange({ ...value, dimensions: value.dimensions.map((item, position) => position === index ? { ...item, id: event.target.value } : item) })} />
          <input aria-label={`${t('tasks.research.requirement')} ${index + 1}`} className={fieldClass} value={dimension.requirement} onChange={event => onChange({ ...value, dimensions: value.dimensions.map((item, position) => position === index ? { ...item, requirement: event.target.value } : item) })} />
          <label className="col-span-2 inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={dimension.required} onChange={event => onChange({ ...value, dimensions: value.dimensions.map((item, position) => position === index ? { ...item, required: event.target.checked } : item) })} />{t('tasks.research.required')}
            {value.dimensions.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...value, dimensions: value.dimensions.filter((_, position) => position !== index) })}>{t('tasks.research.remove')}</Button>}
          </label>
        </div>)}
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...value, dimensions: [...value.dimensions, { id: `dimension-${value.dimensions.length + 1}`, requirement: t('tasks.research.requirement'), required: true }] })}>{t('tasks.research.addDimension')}</Button>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium">{t('tasks.research.sources')}</p>
        <p className="text-xs text-muted-foreground">{t('tasks.research.sourceHint')}</p>
        {value.sources.map((source, index) => <div key={index} className="flex min-w-0 flex-wrap items-center gap-2">
          <input aria-label={`${t('tasks.research.sourceId')} ${index + 1}`} className={`${fieldClass} max-w-24`} value={source.id} onChange={event => onChange({ ...value, sources: value.sources.map((item, position) => position === index ? { ...item, id: event.target.value } : item) })} />
          <input aria-label={`${t('tasks.research.sourcePath')} ${index + 1}`} className={`${fieldClass} flex-1 basis-40`} value={source.path} onChange={event => onChange({ ...value, sources: value.sources.map((item, position) => position === index ? { ...item, path: event.target.value } : item) })} />
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...value, sources: value.sources.filter((_, position) => position !== index) })}>{t('tasks.research.remove')}</Button>
        </div>)}
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...value, sources: [...value.sources, { id: `source-${value.sources.length + 1}`, path: '' }] })}>{t('tasks.research.addSource')}</Button>
      </div>
    </fieldset>
  </details>
}
