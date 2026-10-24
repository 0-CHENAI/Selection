import { useAtomValue, useSetAtom } from 'jotai'
import { pptComposerAtomFamily, pptComposerOverrideAtomFamily, replacePptTemplate } from '@/atoms/ppt'
import { TemplateGallery } from './TemplateGallery'
import { queueTemplateFlight } from './SelectedTemplate'
export function PptHomeGallery({ composerKey }: { composerKey: string }) {
  const setRequest = useSetAtom(pptComposerAtomFamily(composerKey))
  const selectedId = useAtomValue(pptComposerOverrideAtomFamily(composerKey))?.templateId
  return <div className="mx-auto mt-7 w-full max-w-[1000px] min-h-0 overflow-y-auto px-8 pb-8" data-testid="ppt-home-gallery"><TemplateGallery selectedId={selectedId} onSelect={(template, source) => { queueTemplateFlight(composerKey, source); setRequest(value => replacePptTemplate(value, template.id)) }} /></div>
}
