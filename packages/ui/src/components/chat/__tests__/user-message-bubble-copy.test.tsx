import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../tooltip'
import type { StoredAttachment } from '@craft-agent/core'

mock.module('../../markdown', () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}))

let UserMessageBubble: typeof import('../UserMessageBubble').UserMessageBubble

beforeAll(async () => {
  const module = await import('../UserMessageBubble')
  UserMessageBubble = module.UserMessageBubble
})

afterAll(() => {
  mock.restore()
})

async function renderBubble(props: {
  content: string
  attachments?: StoredAttachment[]
  isQueued?: boolean
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
  it('renders a hover-fading copy button on the text bubble', async () => {
    const html = await renderBubble({ content: 'Please backup this prompt' })
    expect(html).toContain('aria-label="Copy"')
    expect(html).toContain('group ')
    expect(html).toContain('opacity-0')
    expect(html).toContain('group-hover:opacity-100')
    expect(html).toContain('focus-visible:opacity-100')
    expect(html).toContain('transition-opacity')
    expect(html).toContain('duration-150')
    expect(html).toContain('motion-reduce:transition-none')
    expect(html).toContain('absolute bottom-1.5 right-1.5')
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

  it('does not change queued layout classes when the copy button is present', async () => {
    const html = await renderBubble({ content: 'queued prompt', isQueued: true })
    expect(html).toContain('Queued')
    expect(html).toContain('aria-label="Copy"')
    expect(html).toContain('absolute bottom-1.5 right-1.5')
  })
})
