import { expect, it, mock } from 'bun:test'
import i18n from 'i18next'
// Match the Vite asset loader in the Bun test environment.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
const { getPreviewText } = await import('../TurnCard')

it('主栏跟随最新步骤，仅在无步骤标签时回退到阶段状态', async () => {
  await i18n.init({ lng: 'zh', resources: { zh: { translation: {
    'chat.processing.thinking': '思考中…',
    'turnCard.responding': '正在回复',
    'turnCard.stepsCompleted': '步骤已完成',
  } } } })
  const activities = [{ id: 'fetch', type: 'tool' as const, status: 'completed' as const,
    toolName: 'WebFetch', intent: '读取网页', timestamp: 1 }]
  expect(getPreviewText(activities, '读取网页', 'awaiting')).toBe('读取网页')
  expect(getPreviewText(activities, '读取网页', 'streaming')).toBe('正在回复')
  expect(getPreviewText([{ ...activities[0]!, status: 'running' }], undefined, 'tool_active')).toBe('读取网页')
  expect(getPreviewText([], undefined, 'pending')).toBe('思考中…')
  expect(getPreviewText([], undefined, 'awaiting')).toBe('思考中…')
  expect(getPreviewText([
    { id: 'ok', type: 'tool' as const, status: 'completed' as const, toolName: 'Read', timestamp: 1 },
    { id: 'err', type: 'tool' as const, status: 'error' as const, toolName: 'Write', timestamp: 2 },
  ], undefined, 'complete')).toBe('步骤已完成')

  const progress = { id: 'progress', type: 'status' as const, status: 'completed' as const,
    statusType: 'task_progress', content: '子代理（2） · 2/2 · 已完成', timestamp: 1000 }
  const research = { id: 'research', type: 'status' as const, status: 'completed' as const,
    taskNode: { title: '检索近期反馈', stateLabel: '完成' }, content: '检索近期反馈 · 完成', timestamp: 10 }
  const review = { ...activities[0]!, id: 'review', intent: '核验关键事实与来源', timestamp: 30 }
  for (const phase of ['awaiting', 'tool_active', 'complete'] as const) {
    expect(getPreviewText([review, research, progress], progress.content, phase)).toBe('核验关键事实与来源')
    expect(getPreviewText([review, research, progress, { ...research, id: 'future-gate',
      statusType: 'task_node', status: 'pending', content: '交付门槛 · 待处理', timestamp: 1001 }], progress.content, phase))
      .toBe('核验关键事实与来源')
  }
  expect(getPreviewText([review, research, progress, { ...research, id: 'revision', status: 'running',
    content: '修订报告 · 运行中', timestamp: 40 }], progress.content, 'tool_active')).toBe('修订报告 · 运行中')
  expect(getPreviewText([progress], progress.content, 'complete')).toBe(progress.content)
})
