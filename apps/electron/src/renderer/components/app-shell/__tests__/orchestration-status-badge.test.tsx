import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { setupI18n } from '@craft-agent/shared/i18n'
import { OrchestrationStatusBadge } from '../OrchestrationStatusBadge'
import { formatSwarmElapsed } from '../SwarmRunDetailsDialog'

const testI18n = setupI18n()

function renderBadge(status: string, onOpenDetails?: () => void, blocker?: string): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <OrchestrationStatusBadge status={status} blocker={blocker} onOpenDetails={onOpenDetails} />
    </I18nextProvider>,
  )
}

describe('OrchestrationStatusBadge details action', () => {
  it('renders every coordinator status as a clickable button when details are available', () => {
    for (const status of ['running', 'completed', 'need-to-check']) {
      const html = renderBadge(status, () => {}, 'Needs input')
      expect(html).toContain('<button')
      expect(html).toContain('type="button"')
      expect(html).toContain('title="Needs input"')
    }
  })

  it('keeps a non-interactive status indicator when no details action exists', () => {
    const html = renderBadge('running')
    expect(html).not.toContain('<button')
    expect(html).toContain('role="status"')
  })
})

describe('formatSwarmElapsed', () => {
  it('formats bounded seconds and minutes deterministically', () => {
    expect(formatSwarmElapsed(-1)).toBe('0s')
    expect(formatSwarmElapsed(59.9)).toBe('59s')
    expect(formatSwarmElapsed(125)).toBe('2m 5s')
  })
})
