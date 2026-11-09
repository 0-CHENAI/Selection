import * as React from 'react'
import { useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { TooltipProvider } from '@craft-agent/ui'
import type { ComponentEntry } from './types'
import { InputContainer } from '@/components/app-shell/input'
import { officeComposerAtomFamily } from '@/atoms/office'
import { pptComposerOverrideAtomFamily } from '@/atoms/ppt'
import { refreshPptCatalog } from '@/components/ppt/usePptCatalog'
import { ensureMockElectronAPI, mockInputCallbacks } from '../mock-utils'

/** The attached PPT template next to an attached Word and Excel case, each in a real input box. */
function OfficeInputCaseDemo() {
  const store = useStore()
  const { i18n } = useTranslation()
  // QA can check any locale with ?lang=zh-Hans etc.
  React.useEffect(() => {
    const lang = new URLSearchParams(window.location.search).get('lang')
    if (lang && lang !== i18n.language) void i18n.changeLanguage(lang)
  }, [i18n])
  React.useState(() => {
    ensureMockElectronAPI()
    // QA serves these images; the playground has no PPT catalog host.
    Object.assign(window.electronAPI, {
      getPptCatalog: async () => ({ themes: [], templates: [{ id: 'qa-ppt', title: '活力营销', category: '商务', canvas: '16:9', pages: 12, cover: '/qa-ppt-cover.png', referencePages: ['/qa-ppt-page-2.png', '/qa-ppt-page-3.png'] }] }),
    })
    refreshPptCatalog()
    store.set(pptComposerOverrideAtomFamily('qa-input-ppt'), { templateId: 'qa-ppt' })
    store.set(officeComposerAtomFamily('qa-input-word'), { mode: 'word', templateId: 'government-notice', revision: '20260914.2' })
    store.set(officeComposerAtomFamily('qa-input-excel'), { mode: 'excel', templateId: 'port-cargo', revision: '20260911.6' })
    return true
  })
  const rows = [
    ['qa-input-ppt', 'PPT', '描述你想要的 PPT：主题、受众、页数、风格…'],
    ['qa-input-word', 'Word', '写下用途、读者和篇幅，或上传资料'],
    ['qa-input-excel', 'Excel', '写下指标、周期和读者，或上传表格'],
  ] as const
  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 p-8" data-office-input-case-qa>
        {rows.map(([key, name, placeholder]) => (
          <div key={key}>
            <div className="mb-1.5 text-[12px] text-muted-foreground">{name}</div>
            <InputContainer
              placeholder={placeholder}
              disabled={false}
              isProcessing={false}
              currentModel="claude-sonnet-4-6"
              sessionId={key}
              sourceSelectionKey={key}
              onSubmit={mockInputCallbacks.onSubmit}
              onModelChange={mockInputCallbacks.onModelChange}
              onInputChange={mockInputCallbacks.onInputChange}
            />
          </div>
        ))}
      </div>
    </TooltipProvider>
  )
}

export const officeInputCaseComponents: ComponentEntry[] = [{
  id: 'office-input-case', name: 'Office 输入框里的模板 / 案例卡片', category: 'Chat',
  description: '输入框里附上的 PPT 模板与 Word / Excel 案例：同一张倾斜封面卡片，× 移除，⋯ 打开菜单（PPT 为模板选项，Word / Excel 为预览样例）。',
  component: OfficeInputCaseDemo,
  props: [],
  layout: 'top',
}]
