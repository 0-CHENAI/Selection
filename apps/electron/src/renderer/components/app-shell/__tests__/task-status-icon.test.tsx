import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { setupI18n } from '@craft-agent/shared/i18n'
import type { BackgroundTaskStatus } from '@/atoms/sessions'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const testI18n = setupI18n()
const src = readFileSync(join(__dirname, '../TaskActionMenu.tsx'), 'utf8')

let TaskStatusIcon: typeof import('../TaskActionMenu').TaskStatusIcon

beforeAll(async () => {
  ;({ TaskStatusIcon } = await import('../TaskActionMenu'))
})

function renderIcon(status: BackgroundTaskStatus): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <TaskStatusIcon status={status} />
    </I18nextProvider>,
  )
}

describe('TaskStatusIcon (#204)', () => {
  it('is a module-level component so elapsed ticks cannot remount Spinner', () => {
    expect(src).toContain('export function TaskStatusIcon')
    expect(src).not.toMatch(/const StatusIcon = /)
  })

  it('uses Spinner only while the task is running', () => {
    expect(renderIcon('running')).toContain('spinner')
    expect(renderIcon('completed')).not.toContain('spinner')
    expect(renderIcon('failed')).not.toContain('spinner')
    expect(renderIcon('stopped')).not.toContain('spinner')
    expect(renderIcon('orphaned')).not.toContain('spinner')
    expect(renderIcon('stale')).not.toContain('spinner')
  })
})
