import * as React from 'react'
import type { ComponentEntry } from './types'
import type { OfficePreviewOperation, OfficePreviewResult } from '@craft-agent/shared/protocol'
import { useTranslation } from 'react-i18next'
import { useAppShellContext } from '@/context/AppShellContext'
import { useOfficePreview } from '@/hooks/useOfficePreview'
import { OfficeCaseGallery } from '@/components/office/OfficeCaseGallery'
import { OfficeSessionCase } from '@/components/office/OfficeSessionCase'
import catalog from '../../../../resources/skills/office-business/catalog.json'

const titles = new Map(((catalog as { cases?: Array<{ id: string; title: string }> }).cases ?? []).map(item => [item.id, item.title]))

/**
 * Real case cards, chat entry and Office panel with a fixed preview RPC. OfficeCLI does not run here:
 * the sample HTML comes from `/office-case-preview/<case>.html` when a QA script serves it, otherwise a stub.
 */
function OfficeCasePreviewDemo({ entry = 'home', mode = 'word' }: { entry?: 'home' | 'chat'; mode?: 'word' | 'excel' }) {
  const base = useAppShellContext()
  const { i18n } = useTranslation()
  // QA can check any locale with ?lang=ja etc.
  React.useEffect(() => {
    const lang = new URLSearchParams(window.location.search).get('lang')
    if (lang && lang !== i18n.language) void i18n.changeLanguage(lang)
  }, [i18n])
  const [chatId] = React.useState(() => `office-case-qa-${crypto.randomUUID()}`)
  const preview = useOfficePreview(entry === 'chat' ? chatId : null, base.activeWorkspaceId)
  const restoreAPI = React.useRef<() => void>()
  React.useLayoutEffect(() => {
    const previous = { officePreview: window.electronAPI.officePreview, getOfficeFiles: window.electronAPI.getOfficeFiles,
      onReconnected: window.electronAPI.onReconnected, onSessionEvent: window.electronAPI.onSessionEvent }
    Object.assign(window.electronAPI, {
      getOfficeFiles: async () => [],
      onReconnected: () => () => {}, onSessionEvent: () => () => {},
      officePreview: async (operation: OfficePreviewOperation): Promise<OfficePreviewResult | void> => {
        if (operation.type === 'prepareCase') {
          const file = operation.caseId.match(/annual|port|bio/) ? 'example.xlsx' : 'example.docx'
          return { previewId: '', artifactId: `office-case:${operation.caseId}`, baseVersion: 'qa', path: `/tmp/selection-office-cases/qa/${operation.caseId}/${titles.get(operation.caseId) ?? operation.caseId}${file.slice(file.lastIndexOf('.'))}`, readOnly: true }
        }
        if (operation.type !== 'open') return
        const caseId = operation.path.split('/').at(-2) ?? ''
        const served = await fetch(`/office-case-preview/${caseId}.html`).then(response => response.ok ? response.text() : '').catch(() => '')
        const html = /<html/i.test(served) ? served
          : `<html><body style="font:16px system-ui;padding:32px"><h1 data-path="/body/p[1]">${caseId}</h1><p data-path="/body/p[2]">案例样例 · 只读</p></body></html>`
        return { previewId: `preview-${caseId}`, artifactId: `office-case:${caseId}`, baseVersion: 'qa', path: operation.path, readOnly: true, html }
      },
    })
    restoreAPI.current = () => Object.assign(window.electronAPI, previous)
  }, [])
  React.useEffect(() => () => restoreAPI.current?.(), [])
  return (
    <div className="flex h-[720px] w-full min-w-0 @container/office-layout" data-office-case-preview-qa={entry}>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto rounded-xl bg-background">
        {entry === 'chat' ? (
          <div className="mt-auto p-6">
            <div className="mb-4 text-sm text-muted-foreground">已有会话</div>
            <OfficeSessionCase sessionId={chatId} office={{ mode, templateId: mode === 'word' ? 'government-notice' : 'port-cargo' }} />
            <div className="h-24 rounded-[12px] border border-border/60 p-3 text-sm text-muted-foreground">继续描述你的修改…</div>
          </div>
        ) : <OfficeCaseGallery mode={mode} composerKey={`office-case-qa-${mode}`} />}
      </div>
      {preview.panel}
    </div>
  )
}

export const officeCasePreviewComponents: ComponentEntry[] = [{
  id: 'office-case-preview', name: 'Office 案例样例预览', category: 'Chat',
  description: '首页案例卡片「预览」与会话内案例入口，在右侧 Office 协同面板只读打开样例。RPC 使用固定数据。',
  component: OfficeCasePreviewDemo,
  props: [
    { name: 'entry', control: { type: 'select', options: [{ label: '首页', value: 'home' }, { label: '会话内', value: 'chat' }] }, defaultValue: 'home' },
    { name: 'mode', control: { type: 'select', options: [{ label: 'Word', value: 'word' }, { label: 'Excel', value: 'excel' }] }, defaultValue: 'word' },
  ],
  variants: [
    { name: 'home-word', props: { entry: 'home', mode: 'word' } },
    { name: 'home-excel', props: { entry: 'home', mode: 'excel' } },
    { name: 'chat-word', props: { entry: 'chat', mode: 'word' } },
  ],
  layout: 'top',
}]
