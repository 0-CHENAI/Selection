import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { setupI18n } from '@craft-agent/shared/i18n'
import type { Message } from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const testI18n = setupI18n()
let ErrorMessage: typeof import('../ChatErrorMessage').ErrorMessage

beforeAll(async () => {
  ;({ ErrorMessage } = await import('../ChatErrorMessage'))
})

function renderError(message: Message, compactMode = false): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <ErrorMessage message={message} compactMode={compactMode} onRetry={() => {}} onOpenUrl={() => {}} />
    </I18nextProvider>,
  )
}

const providerError: Message = {
  id: 'err-1',
  role: 'error',
  content: '服务暂时不可用',
  timestamp: 1,
  errorTitle: '服务错误',
  errorCanRetry: true,
  errorOriginal: 'upstream 503',
  errorActions: [
    { key: 'r', label: 'Retry', action: 'retry' },
    { key: 's', label: 'Check proxy settings', action: 'settings' },
    { key: 'docs', label: 'Status', action: 'open_url', url: 'https://example.com/status' },
  ],
}

describe('error retry action row', () => {
  it('moves retry below the error text and keeps the failure details', () => {
    const html = renderError(providerError)
    expect(html.indexOf('服务错误')).toBeLessThan(html.indexOf('data-response-actions'))
    expect(html.indexOf('服务暂时不可用')).toBeLessThan(html.indexOf('data-action="retry"'))
    expect(html).toContain('Show technical details')
    expect(html).toContain('Check proxy settings')
    expect(html).toContain('Status ↗')

    const retryAt = html.indexOf('data-action="retry"')
    const retryButton = html.slice(html.lastIndexOf('<button', retryAt), html.indexOf('</button>', retryAt))
    expect(retryButton).toContain('turn-action-btn')
    expect(retryButton).toContain('text-muted-foreground')
    expect(retryButton).toContain('hover:text-foreground')
    expect(retryButton).not.toContain('border-destructive')
    expect(html).toContain('lucide-refresh-cw')

    const settingsAt = html.indexOf('Check proxy settings')
    const settingsButton = html.slice(html.lastIndexOf('<button', settingsAt), html.indexOf('</button>', settingsAt))
    expect(settingsButton).toContain('border-destructive/20')
    expect(settingsButton).not.toContain('data-action="retry"')
  })

  it('uses the compact action row under a compact error', () => {
    const html = renderError(providerError, true)
    expect(html).toMatch(/data-response-actions=""[^>]*class="[^"]*pl-2\.5 pr-2 py-1\.5/)
    expect(html).toContain('bg-muted/20')
  })

  it('does not offer retry for a terminal interruption, but still shows the error', () => {
    const html = renderError({
      ...providerError,
      errorCode: 'stream_interrupted',
      errorCanRetry: false,
      content: '回复流中断',
    })
    expect(html).toContain('Response stream interrupted')
    expect(html).not.toContain('data-action="retry"')
    expect(html).toContain('Check proxy settings')
  })
})
