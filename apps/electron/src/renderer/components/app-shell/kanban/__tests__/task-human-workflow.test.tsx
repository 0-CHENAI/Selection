import { expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import i18next, { type InitOptions } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const { TaskApproval } = await import('../TaskApproval')
const { PROPOSAL_UI_TIMEOUT_MS, TaskProposal } = await import('../TaskProposal')

function editorSource(): string {
  return readFileSync(join(import.meta.dir, '../TaskEditor.tsx'), 'utf8')
}

function renderZh(node: ReactNode): string {
  const instance = i18next.createInstance()
  void instance.init({
    lng: 'zh-Hans',
    fallbackLng: 'en',
    initImmediate: false,
    resources: Object.fromEntries(
      Object.entries(LOCALE_REGISTRY).map(([code, entry]) => [code, { translation: entry.messages }]),
    ),
  } as InitOptions)
  return renderToStaticMarkup(<I18nextProvider i18n={instance}>{node}</I18nextProvider>)
}

it('opens the form editor first and keeps YAML import optional', () => {
  const source = editorSource()
  expect(source).toContain("useState<'editor' | 'import' | 'library'>('editor')")
  expect(source).toContain('onImport={() => setPane(\'import\')}')
  expect(source).toContain("t('tasks.yamlImportTitle')")
  expect(source).toContain("t('tasks.templateLibrary')")
  expect(source).toContain('<TaskProposal')
  expect(source).toContain('<TaskApproval')
  expect(source).toContain('{isEdit && <Btn variant="primary" onClick={() => submit(true)}')
  expect(source).not.toMatch(/if \(!isEdit\)[\s\S]{0,200}TaskYamlImport/)
})

it('keeps the UI proposal timeout slightly above the server generate timeout', () => {
  expect(PROPOSAL_UI_TIMEOUT_MS).toBeGreaterThan(180_000)
  expect(PROPOSAL_UI_TIMEOUT_MS).toBeLessThan(210_000)
})

it('renders an AI proposal surface that is not an import-only form', () => {
  const html = renderZh(
    <TaskProposal workspaceId="ws" draftIdentity="{}" onApply={() => {}} />,
  )
  expect(html).toContain('AI 辅助编排')
  expect(html).toContain('生成提案')
  expect(html).toContain('<details open')
  expect(html).not.toContain('导入编排')
})

it('renders approval actions that distinguish approve, reject, and feedback-only', () => {
  const run: TaskRunSnapshotDto = {
    slug: 'qa-288',
    runId: 'run-1',
    taskId: 'qa-288',
    status: 'waiting-approval',
    tokensUsed: 0,
    nodes: [{
      id: 'review',
      state: 'waiting-approval',
      attempt: 1,
      approvalDefinition: { title: 'Review', prompt: 'Check ${nodes.draft.output}', dependsOn: ['draft'] },
      approvalFeedback: '改到下周一',
    }],
  }
  const html = renderZh(
    <TaskApproval workspaceId="ws" run={run} nodeId="review" onChange={() => {}} />,
  )
  expect(html).toContain('等待你的决策')
  expect(html).toContain('批准 review')
  expect(html).toContain('拒绝 review')
  expect(html).toContain('发送意见，保持等待')
  expect(html).toContain('上游输出')
  expect(html).toContain('改到下周一')
})
