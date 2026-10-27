import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import type { PptProgress } from '@craft-agent/shared/protocol'
import { OfficeCollaborationButtonFace } from './OfficeCollaborationButtonFace'
import { officeButtonCopy, officeCollaborationLiveProgress } from './office-collaboration-progress'

const i18n = i18next.createInstance()
await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } } })

function liveProgress(extra: Partial<PptProgress> = {}) {
  return officeCollaborationLiveProgress({
    total: 15,
    completed: 5,
    current: 6,
    currentTitle: '市场机会',
    generating: true,
    ...extra,
  })
}

test('generation fills the Office button and keeps stop off it', () => {
  const live = liveProgress()
  const copy = officeButtonCopy(i18n.t.bind(i18n), { active: true, live })
  const html = renderToStaticMarkup(
    <OfficeCollaborationButtonFace
      label={copy.label}
      pressed
      expanded
      generating
      progress={live?.fraction}
      pageTooltip={copy.pageTooltip}
      onClick={() => {}}
    />,
  )
  expect(copy.tooltip).toBe('第 6/15 页 · 市场机会')
  expect(html).toContain('Office 协同 · 6/15')
  expect(html).toContain('data-testid="office-collaboration-progress"')
  expect(html).toContain('data-progress="0.4"')
  expect(html).toContain('width:40%')
  expect(html).toContain('data-ppt-tooltip="第 6/15 页 · 市场机会"')
  expect(html).toContain('data-generating="true"')
  expect(html).toContain('aria-pressed="true"')
  expect(html).not.toContain('lucide-check')
  expect(html).not.toContain('停止')
  expect(html).not.toContain('border-dashed')
  expect(html).not.toContain('rounded-full')
})

test('a settled deck restores the checked Office button', () => {
  const copy = officeButtonCopy(i18n.t.bind(i18n), { active: true, live: null })
  const html = renderToStaticMarkup(
    <OfficeCollaborationButtonFace label={copy.label} pressed expanded={false} generating={false} onClick={() => {}} />,
  )
  expect(copy.label).toBe('Office 协同')
  expect(copy.tooltip).toBe('关闭 Office 预览')
  expect(html).toContain('>Office 协同<')
  expect(html).toContain('lucide-check')
  expect(html).not.toContain('data-testid="office-collaboration-progress"')
  expect(html).not.toContain('data-generating')
  expect(html).not.toContain('6/15')
  expect(html).not.toContain('停止')
})

test('an in-flight deck without a page count stays a plain Office button', () => {
  const copy = officeButtonCopy(i18n.t.bind(i18n), { active: false, live: liveProgress({ total: 0, completed: 0, current: undefined, currentTitle: undefined }) })
  const html = renderToStaticMarkup(
    <OfficeCollaborationButtonFace label={copy.label} pressed={false} expanded={false} generating onClick={() => {}} />,
  )
  expect(copy.pageTooltip).toBeUndefined()
  expect(html).toContain('data-generating="true"')
  expect(html).toContain('>Office 协同<')
  expect(html).not.toContain('data-testid="office-collaboration-progress"')
  expect(html).not.toContain('0/0')
})
