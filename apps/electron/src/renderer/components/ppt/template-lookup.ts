import type { PptTemplate } from '@craft-agent/shared/protocol'

/** Visible cards plus color variants nested on 理性简报. */
export function resolvePptTemplate(templates: PptTemplate[] | undefined, id: string | undefined): PptTemplate | undefined {
  if (!templates || !id) return undefined
  const direct = templates.find(item => item.id === id)
  if (direct) return direct
  for (const template of templates) {
    const variant = template.variants?.find(item => item.id === id)
    if (variant) return { ...template, id: variant.id, title: `${template.title} · ${variant.title}`, cover: variant.cover, referencePages: variant.referencePages }
  }
  return undefined
}
