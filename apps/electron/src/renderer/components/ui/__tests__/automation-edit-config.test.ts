import { beforeAll, describe, expect, mock, test } from 'bun:test'
import i18n from 'i18next'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
// Configuration factories do not render the chat; keep Vite-only UI dependencies out of Bun.
mock.module('../../app-shell/ChatDisplay', () => ({ ChatDisplay: () => null }))

let getEditConfig: typeof import('../EditPopover').getEditConfig
let getAutomationEditConfig: typeof import('../EditPopover').getAutomationEditConfig

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: {} })
  ;({ getEditConfig, getAutomationEditConfig } = await import('../EditPopover'))
})

describe('automation configuration intent', () => {
  test('each category supplies distinct context, title and trigger instructions while sharing storage', () => {
    const keys = ['add-automation-scheduled', 'add-automation-event', 'add-automation-agentic'] as const
    const configs = keys.map(key => getEditConfig(key, '/workspace'))
    expect(new Set(configs.map(config => config.contextKey)).size).toBe(3)
    expect(new Set(configs.map(config => config.displayLabelKey)).size).toBe(3)
    for (const config of configs) {
      expect(config.context.filePath).toBe('/workspace/automations.json')
      expect(config.context.context).toContain('Preserve all existing automation IDs')
      expect(config.creationKind).toBe('automation')
    }
    expect(configs[0].context.context).toContain('SchedulerTick, cron')
    expect(configs[1].context.context).toContain('LabelAdd')
    expect(configs[2].context.context).toContain('PostToolUseFailure')
  })

  test('detail edits are bound to the selected rule ID and identified by name', () => {
    const first = getAutomationEditConfig('/workspace', { id: 'a12345', name: 'Daily checklist' })
    const second = getAutomationEditConfig('/workspace', { id: 'b12345', name: 'Review' })
    expect(first.contextKey).not.toBe(second.contextKey)
    expect(first.displayLabel).toContain('Daily checklist')
    expect(first.context.context).toContain('Edit only the automation with ID "a12345"')
    expect(second.context.context).toContain('Edit only the automation with ID "b12345"')
    expect(first.context.context).toContain('Preserve its ID and all other automation entries')
    expect(first.creationKind).toBeUndefined()
  })
})
