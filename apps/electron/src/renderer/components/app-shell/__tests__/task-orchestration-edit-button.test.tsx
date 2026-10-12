import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next, { type InitOptions } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
let TaskGraphButton: typeof import('../../ui/TaskGraphButton').TaskGraphButton
let TooltipProvider: typeof import('@craft-agent/ui').TooltipProvider
beforeAll(async () => {
  ;({ TaskGraphButton } = await import('../../ui/TaskGraphButton'))
  ;({ TooltipProvider } = await import('@craft-agent/ui'))
})

describe('PRO automatic task graph entry', () => {
  it.each(['en', 'zh-Hans'] as const)('names a read-only dialog in %s', language => {
    const i18n = i18next.createInstance()
    void i18n.init({ lng: language, initImmediate: false, resources: { [language]: { translation: LOCALE_REGISTRY[language].messages } } } as InitOptions)
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><TooltipProvider><TaskGraphButton open={false} onOpen={() => {}} /></TooltipProvider></I18nextProvider>)
    expect(html).toContain(`aria-label="${LOCALE_REGISTRY[language].messages['tasks.graphTitle']}"`)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('lucide-workflow')
    expect(html).not.toContain('Edit')
  })

  it('gates the observer on PRO capability and never navigates to authoring', () => {
    const source = readFileSync(join(import.meta.dir, '../../../pages/ChatPage.tsx'), 'utf8')
    expect(source).toContain('!capabilityError && isTaskOrchestrator && hasOrchestrationRun')
    expect(source).not.toContain('routes.view.board()')
    expect(source).not.toContain('kanbanEditorTargetAtom')
    expect(source).toContain('AutomaticTaskGraphDialog')
  })

  it('retires old board URLs even when the former advanced flag is enabled', () => {
    const source = readFileSync(join(import.meta.dir, '../../../contexts/NavigationContext.tsx'), 'utf8')
    expect(source).not.toContain('dagOrchestrationEnabledRef')
    expect(source.match(/=== 'board'/g)?.length).toBeGreaterThanOrEqual(5)
    expect(source).toContain("requested.name === 'board'")
  })
})
