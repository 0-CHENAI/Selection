import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../tooltip'
import type { StoredAttachment } from '@craft-agent/core'
import { buildArtifactRestoreResult } from '@craft-agent/shared/utils/artifact-restore-message'
import type { ManagedArtifact } from '@craft-agent/shared/protocol'

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
          'chat.artifactVersions.restore': 'Restore this version',
          'chat.artifactVersions.previousVersion': 'Previous version',
          'chat.artifactVersions.version': 'Version {{number}}',
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
  it('renders the restored version summary below the centered file and version change', async () => {
    const record = { id: 'artifact', path: '/workspace/hello.docx', currentVersion: 'v2', versions: [
      { id: 'v1', ordinal: 1, summary: '生成仅含 hello 的 Word 文档', summaryOrigin: 'assistant' }, { id: 'v2', ordinal: 2 },
    ] } as ManagedArtifact
    const html = await renderBubble({ content: buildArtifactRestoreResult(record, 'v1') })
    expect(html).toContain('hello.docx')
    expect(html).toContain('Version 2')
    expect(html).toContain('Version 1')
    expect(html).toContain('生成仅含 hello 的 Word 文档')
    expect(html).not.toContain('artifact_restore_result')
  })

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

  it('renders a restore request in icon, filename, version order without its JSON payload', async () => {
    const path = '/workspace/hello.docx'
    const request = { action: 'restore', path, artifactId: 'a1', versionId: 'v1', expectedVersion: 'v2' }
    const content = `请将成果文件 ${JSON.stringify(path)} 从第 2 版恢复到第 1 版。使用 artifact_versions 工具，原样传入下方 JSON 的全部字段执行恢复，并报告当前版本；如果文件已变化，请先说明冲突，不要覆盖。\n\n<artifact_restore_request>\n${JSON.stringify(request)}\n</artifact_restore_request>`
    const html = await renderBubble({ content })
    expect(html).toContain('data-file-kind="word"')
    expect(html).toContain('hello.docx')
    expect(html).toContain('Version 2')
    expect(html).toContain('Version 1')
    expect(html).toContain('flex-col items-center gap-2')
    expect(html).toContain('self-stretch truncate text-center')
    expect(html).toContain('h-10 w-10')
    expect(html).toContain('font-medium text-success">Version 1')
    expect(html.indexOf('data-file-kind="word"')).toBeLessThan(html.indexOf('hello.docx'))
    expect(html.indexOf('hello.docx')).toBeLessThan(html.indexOf('Version 2'))
    expect(html.indexOf('Version 2')).toBeLessThan(html.indexOf('Version 1'))
    expect(html).not.toContain('Restore this version')
    expect(html).not.toContain('artifact_restore_request')
    expect(html).not.toContain('artifactId')
    expect(html).toContain('aria-label="Copy"')
  })

  it('labels the unknown source of a historical restore request without guessing its number', async () => {
    const path = '/workspace/hello.docx'
    const request = { action: 'restore', path, artifactId: 'a1', versionId: 'v1', expectedVersion: 'unmapped-id' }
    const content = `请将成果文件 ${JSON.stringify(path)} 恢复到第 1 版。使用 artifact_versions 工具，原样传入下方 JSON 的全部字段执行恢复，并报告新版本；如果文件已变化，请先说明冲突，不要覆盖。\n\n<artifact_restore_request>\n${JSON.stringify(request)}\n</artifact_restore_request>`
    const html = await renderBubble({ content })
    expect(html).toContain('Previous version')
    expect(html).toContain('font-medium text-success">Version 1')
    expect(html).not.toContain('Version 2')
  })
})
