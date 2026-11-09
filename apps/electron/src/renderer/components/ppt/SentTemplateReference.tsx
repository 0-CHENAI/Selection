import { useTranslation } from 'react-i18next'
import type { PptRequest } from '@craft-agent/shared/protocol'
import { resolvePptTemplate } from './template-lookup'
import { usePptCatalog } from './usePptCatalog'

export function SentTemplateReference({ request }: { request: unknown }) {
  const { t } = useTranslation()
  const { catalog } = usePptCatalog()
  const templateId = request && typeof request === 'object' ? (request as PptRequest).templateId : undefined
  const template = resolvePptTemplate(catalog?.templates, templateId)
  if (!template) return null
  return <div title={t('ppt.referenceTemplate', { title: template.title })} className="h-14 w-[98px] shrink-0 overflow-hidden rounded-[8px] border border-border/50 bg-background shadow-minimal" data-testid="ppt-sent-template"><img src={template.cover} alt={t('ppt.referenceTemplate', { title: template.title })} className="h-full w-full object-cover" /></div>
}
