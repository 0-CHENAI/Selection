import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../tooltip'
import type { StoredAttachment } from '@craft-agent/core'

// Match the Vite asset loader in the Bun test environment. Module mocks are
// process-wide in Bun, so never null out shared UI modules (../../markdown)
// — sibling test files need the real implementation.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let UserMessageBubble: typeof import('../UserMessageBubble').UserMessageBubble
let formatUserMessageTime: typeof import('../UserMessageBubble').formatUserMessageTime

beforeAll(async () => {
  const module = await import('../UserMessageBubble')
  UserMessageBubble = module.UserMessageBubble
  formatUserMessageTime = module.formatUserMessageTime
})

async function renderBubble(props: {
  content: string
  attachments?: StoredAttachment[]
  isQueued?: boolean
  timestamp?: number
}) {
  const testI18n = createInstance()
  await testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          'common.copy': 'Copy',
          'common.copied': 'Copied!',
          'chat.queuedBadge': 'Queued',
        },
      },
    },
    interpolation: { escapeValue: false },
  })

  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <TooltipProvider>
        <UserMessageBubble {...props} />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

describe('UserMessageBubble copy control (#372)', () => {
  it('places time and copy under the bubble, not over the text', async () => {
    const sentAt = Date.UTC(2026, 8, 15, 6, 36)
    const html = await renderBubble({ content: 'Please backup this prompt', timestamp: sentAt })
    expect(html).toContain('aria-label="Copy"')
    expect(html).toContain(formatUserMessageTime(sentAt, 'en'))
    expect(html).toContain('<time')
    expect(html).not.toContain('absolute bottom-1.5 right-1.5')
    expect(html).toContain('flex items-center justify-end gap-2 pt-1')
    expect(html).toContain('transition-opacity duration-200 ease-in-out')
    expect(html).not.toContain('duration-150')
    expect(html).not.toContain('motion-reduce:hidden')
    expect(html).toContain('motion-reduce:transition-none')
  })

  it('hides the button when the visible body is empty', async () => {
    const html = await renderBubble({
      content: '',
      attachments: [{
        id: 'att-1',
        name: 'shot.png',
        type: 'image',
        mimeType: 'image/png',
        size: 12,
        storedPath: '/tmp/shot.png',
      }],
    })
    expect(html).not.toContain('aria-label="Copy"')
  })

  it('does not overlay queued text when the copy button is present', async () => {
    const html = await renderBubble({ content: 'queued prompt', isQueued: true })
    expect(html).toContain('Queued')
    expect(html).toContain('aria-label="Copy"')
    expect(html).not.toContain('absolute bottom-1.5 right-1.5')
  })
})
