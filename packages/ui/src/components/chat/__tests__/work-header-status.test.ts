import { expect, it, mock } from 'bun:test'
import i18n from 'i18next'
// Match the Vite asset loader in the Bun test environment.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
const { getPreviewText } = await import('../TurnCard')

it('主栏优先展示当前思考和正文阶段，不沿用已完成工具摘要', async () => {
  await i18n.init({ lng: 'zh', resources: { zh: { translation: {
    'chat.processing.thinking': '思考中…',
    'turnCard.responding': '正在回复',
  } } } })
  const activities = [{ id: 'fetch', type: 'tool' as const, status: 'completed' as const,
    toolName: 'WebFetch', intent: '读取网页', timestamp: 1 }]
  expect(getPreviewText(activities, '读取网页', 'awaiting')).toBe('思考中…')
  expect(getPreviewText(activities, '读取网页', 'streaming')).toBe('正在回复')
  expect(getPreviewText([{ ...activities[0]!, status: 'running' }], undefined, 'tool_active')).toBe('读取网页')
})
