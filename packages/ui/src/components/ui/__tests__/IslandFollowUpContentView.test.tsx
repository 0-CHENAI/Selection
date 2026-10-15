import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let IslandFollowUpContentView: typeof import('../IslandFollowUpContentView').IslandFollowUpContentView

beforeAll(async () => {
  const module = await import('../IslandFollowUpContentView')
  IslandFollowUpContentView = module.IslandFollowUpContentView
})

const resources = {
  en: {
    translation: {
      'chat.followUp': 'Follow-up',
      'chat.followUpRevisionResult': 'View revision',
      'chat.followUpSaveAndSend': 'Save & Send',
      'chat.annotationPlaceholder': 'Add a note…',
      'chat.moreSubmitActions': 'More submit actions',
      'chat.artifactVersions.resolve': 'Mark resolved',
      'chat.artifactVersions.discardDraft': 'Discard draft',
      'common.cancel': 'Cancel',
      'common.close': 'Close',
      'common.continue': 'Continue',
      'common.edit': 'Edit',
      'common.delete': 'Delete',
    },
  },
  'zh-Hans': {
    translation: {
      'chat.followUp': '追问',
      'chat.followUpRevisionResult': '查看修订结果',
      'chat.annotationPlaceholder': '添加备注…',
      'chat.artifactVersions.resolve': '标记已解决',
      'common.cancel': '取消',
      'common.close': '关闭',
      'common.edit': '编辑',
      'common.delete': '删除',
    },
  },
}

async function renderCard(
  props: Partial<ComponentProps<typeof IslandFollowUpContentView>> & { language?: string },
) {
  const { language = 'zh-Hans', ...rest } = props
  const testI18n = createInstance()
  await testI18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    resources,
    interpolation: { escapeValue: false },
  })
  const onCancel = () => {}
  const onSubmit = () => {}
  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <IslandFollowUpContentView
        id="confirm-follow-up"
        value="可是我现在没有安装deck，这个要删除么?"
        onValueChange={() => {}}
        onCancel={onCancel}
        onSubmit={onSubmit}
        onDelete={() => {}}
        onRequestEdit={() => {}}
        {...rest}
      />
    </I18nextProvider>,
  )
}

function actionLabels(html: string) {
  return {
    delete: html.includes('>删除<') || html.includes('>Delete<'),
    cancel: html.includes('>取消<') || html.includes('>Cancel<'),
    edit: html.includes('>编辑<') || html.includes('>Edit<'),
    close: html.includes('aria-label="关闭"') || html.includes('aria-label="Close"'),
  }
}

describe('sent follow-up card', () => {
  it('is display-only while processing and keeps the status line', async () => {
    const html = await renderCard({
      mode: 'view',
      feedbackStatus: 'running',
      feedbackStatusLabel: '处理中',
    })
    const actions = actionLabels(html)
    expect(html).toContain('追问')
    expect(html).toContain('处理中')
    expect(html).toContain('可是我现在没有安装deck，这个要删除么?')
    expect(html).toContain('animate-spin')
    expect(actions.close).toBe(true)
    expect(actions.delete).toBe(false)
    expect(actions.cancel).toBe(false)
    expect(actions.edit).toBe(false)
    expect(html).not.toContain('text-red-500')
  })

  it('stays display-only after the user confirms the revision and keeps the result button', async () => {
    const html = await renderCard({
      mode: 'view',
      feedbackStatus: 'delivered',
      feedbackStatusLabel: '用户已确认解决',
      onOpenResult: () => {},
      resultLabel: '查看修订结果',
    })
    const actions = actionLabels(html)
    expect(html).toContain('用户已确认解决')
    expect(html).toContain('查看修订结果')
    expect(actions.close).toBe(true)
    expect(actions.delete).toBe(false)
    expect(actions.cancel).toBe(false)
    expect(actions.edit).toBe(false)
  })

  it('hides edit and delete even if the parent still requests edit mode after send', async () => {
    const html = await renderCard({
      mode: 'edit',
      feedbackStatus: 'running',
      feedbackStatusLabel: '处理中',
    })
    const actions = actionLabels(html)
    expect(html).toContain('readonly')
    expect(actions.close).toBe(true)
    expect(actions.delete).toBe(false)
    expect(actions.cancel).toBe(false)
    expect(actions.edit).toBe(false)
  })

  it('keeps delete, cancel, and edit on an unsent draft opened from a chip', async () => {
    const html = await renderCard({ mode: 'view' })
    const actions = actionLabels(html)
    expect(actions.delete).toBe(true)
    expect(actions.cancel).toBe(true)
    expect(actions.edit).toBe(true)
    expect(actions.close).toBe(false)
    expect(html).toContain('text-red-500')
  })

  it('keeps cancel and save on an unsent composer', async () => {
    const html = await renderCard({
      language: 'en',
      mode: 'edit',
      value: 'Need a clearer example',
      onDelete: undefined,
    })
    expect(html).toContain('>Cancel<')
    expect(html).toContain('>Continue<')
    expect(html).not.toContain('>Delete<')
    expect(html).not.toContain('>Edit<')
    expect(html).not.toContain('aria-label="Close"')
  })
})
