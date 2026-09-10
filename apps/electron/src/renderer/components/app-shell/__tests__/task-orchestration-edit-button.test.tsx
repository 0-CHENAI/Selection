import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next, { type InitOptions } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let TaskOrchestrationEditButton: typeof import('../../ui/TaskOrchestrationEditButton').TaskOrchestrationEditButton
let TooltipProvider: typeof import('@craft-agent/ui').TooltipProvider

beforeAll(async () => {
  ;({ TaskOrchestrationEditButton } = await import('../../ui/TaskOrchestrationEditButton'))
  ;({ TooltipProvider } = await import('@craft-agent/ui'))
})

function render(language: 'en' | 'zh-Hans', compact = false, disabled = false) {
  const i18n = i18next.createInstance()
  void i18n.init({
    lng: language,
    initImmediate: false,
    resources: { [language]: { translation: LOCALE_REGISTRY[language].messages } },
  } as InitOptions)
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <TaskOrchestrationEditButton compact={compact} disabled={disabled} onEdit={() => {}} />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

const chatSource = readFileSync(join(import.meta.dir, '../../../pages/ChatPage.tsx'), 'utf8')
const buttonSource = readFileSync(join(import.meta.dir, '../../ui/TaskOrchestrationEditButton.tsx'), 'utf8')
const headerSource = readFileSync(join(import.meta.dir, '../../ui/PanelHeaderCenterButton.tsx'), 'utf8')

describe('task orchestration edit entry (#282)', () => {
  it.each(['en', 'zh-Hans'] as const)('renders accurate %s name, hidden icon, and linked purpose text', (language) => {
    const html = render(language)
    const messages = LOCALE_REGISTRY[language].messages
    expect(html).toContain(`aria-label="${messages['kanban.editOrchestration']}"`)
    expect(html).toContain('lucide-workflow')
    expect(html).not.toContain('lucide-pencil')
    expect(html).toContain('aria-hidden="true"')
    const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(descriptionId).toBeDefined()
    expect(html).toContain(`<span id="${descriptionId}" class="sr-only">`)
    expect(html).toContain(messages['kanban.editOrchestrationDescription'])
    expect(html).toContain('focus-visible:ring-1')
  })

  it('advertises a dialog in compact mode and preserves native disabled state', () => {
    const compact = render('en', true)
    expect(compact).toContain('aria-haspopup="dialog"')
    expect(compact).toContain('aria-expanded="false"')
    expect(render('en', false, true)).toContain('disabled=""')
    expect(render('en')).not.toContain('aria-haspopup="dialog"')
  })

  it('explains definition edits, reruns, and unchanged replies/history in both languages', () => {
    const en = LOCALE_REGISTRY.en.messages['kanban.editOrchestrationDescription']
    const zh = LOCALE_REGISTRY['zh-Hans'].messages['kanban.editOrchestrationDescription']
    for (const text of ['goals', 'acceptance criteria', 'subtasks', 'dependencies', 'execution settings', 'new definition', 'does not rename', 'existing replies or run history']) expect(en).toContain(text)
    for (const text of ['目标', '验收标准', '子任务', '依赖关系', '执行配置', '新定义重新运行', '不会重命名会话', '不会改写已有回复或运行历史']) expect(zh).toContain(text)
  })

  it('keeps the top-level spec-backed condition and original editor target/navigation', () => {
    expect(chatSource).toContain('const taskSlug = session?.taskSlug ?? sessionMeta?.taskSlug')
    expect(chatSource).toContain('const isTaskOrchestrator = !!taskSlug && !(session?.parentSessionId || sessionMeta?.parentSessionId)')
    expect(chatSource).toContain('if (!isTaskOrchestrator) return undefined')
    expect(chatSource).toContain('compact={!!isCompactMode}')
    expect(chatSource).toContain('onEdit={handleEditTask}')
    const handler = chatSource.slice(chatSource.indexOf('const handleEditTask ='), chatSource.indexOf('const handlePreviewOrchestrationNode ='))
    expect(handler).toContain('if (!taskSlug) return')
    expect(handler).toContain("mode: 'edit'")
    expect(handler).toContain('sessionId,')
    expect(handler).toContain('taskSlug,')
    expect(handler).toContain('initialTitle: sessionMeta ? getSessionTitle(sessionMeta) : undefined')
    expect(handler).toContain('navigate(routes.view.board())')
  })

  it('wires title and description to hover/focus tooltip and explicit touch confirmation', () => {
    expect(headerSource).toContain('<TooltipTrigger asChild>')
    expect(headerSource).toContain('{tooltipDescription}</p>')
    expect(buttonSource).toContain('tooltipDescription={description}')
    expect(buttonSource).toContain("pointerType.current === 'touch' || pointerType.current === 'pen'")
    expect(buttonSource).toContain('event.detail !== 0')
    expect(buttonSource).toContain('if (compact || touch) {')
    expect(buttonSource).toContain('setOpen(true)')
    expect(buttonSource).toContain('tooltipDisabled={open}')
    expect(headerSource).toContain('open={!tooltipDisabled && tooltipOpen} onOpenChange={setTooltipOpen}')
    expect(buttonSource).toContain('else onEdit()')
    expect(buttonSource).toContain('setOpen(false); onEdit()')
    expect(buttonSource).toContain("t('kanban.openOrchestrationEditor')")
    expect(buttonSource).toContain('onCloseAutoFocus=')
    expect(buttonSource).toContain('if (restoreTriggerFocus.current) triggerRef.current?.focus()')
    expect(buttonSource).toContain('onInteractOutside={() => { restoreTriggerFocus.current = false }}')
    expect(buttonSource).toContain('restoreTriggerFocus.current = false; setOpen(false); onEdit()')
  })
})
