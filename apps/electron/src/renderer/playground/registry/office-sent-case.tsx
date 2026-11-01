import * as React from 'react'
import type { ComponentEntry } from './types'
import { UserMessageBubble } from '@craft-agent/ui'
import { SentTemplateReference } from '@/components/ppt/SentTemplateReference'
import { refreshPptCatalog } from '@/components/ppt/usePptCatalog'
import { SentOfficeCase } from '@/components/office/SentOfficeCase'

/** Sent user messages with a reference card: an existing PPT template next to a Word and an Excel case. */
function OfficeSentCaseDemo() {
  React.useState(() => {
    // QA serves the cover from /qa-ppt-cover.png; the playground has no PPT catalog host.
    Object.assign(window.electronAPI, {
      getPptCatalog: async () => ({ themes: [], templates: [{ id: 'qa-ppt', title: '活力营销', category: '商务', canvas: '16:9', pages: 12, cover: '/qa-ppt-cover.png', referencePages: [] }] }),
    })
    refreshPptCatalog()
    return true
  })
  const time = new Date('2026-11-01T11:30:00+08:00').getTime()
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 p-8" data-office-sent-case-qa>
      <UserMessageBubble content="做一份新品发布的营销方案" timestamp={time} leadingAttachment={<SentTemplateReference request={{ templateId: 'qa-ppt' }} />} />
      <UserMessageBubble content="帮我写一份 11 月消防安全检查的通知" timestamp={time} leadingAttachment={<SentOfficeCase office={{ mode: 'word', templateId: 'government-notice', revision: '20260914.2' }} sessionId="qa" />} />
      <UserMessageBubble content="用附件的出货记录做季度物流分析" timestamp={time} leadingAttachment={<SentOfficeCase office={{ mode: 'excel', templateId: 'port-cargo', revision: '20260911.6' }} sessionId="qa" />} />
    </div>
  )
}

export const officeSentCaseComponents: ComponentEntry[] = [{
  id: 'office-sent-case', name: 'Office 已发送消息的参考案例', category: 'Chat',
  description: '已发送的用户消息上方的参考卡片：PPT 模板、Word 案例、Excel 案例同一样式；点 Word / Excel 卡片只读预览样例。',
  component: OfficeSentCaseDemo,
  props: [],
  layout: 'top',
}]
