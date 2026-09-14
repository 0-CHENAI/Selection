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
// The real provider loads bundled themes via Vite's import.meta.glob. These
// server-rendered component assertions must also work in a standalone Bun run.
mock.module('../../../../context/ThemeContext', () => ({ useTheme: () => ({ isDark: false, theme: 'light' }) }))

const { TaskApproval } = await import('../TaskApproval')
const { ThoughtAnswerHistory } = await import('../ThoughtAnswerHistory')
const { ThoughtGenerationHistory } = await import('../ThoughtGenerationHistory')
const { ThoughtGenerationOutput } = await import('../ThoughtGenerationOutput')
const { ExecutionThoughtSources } = await import('../ExecutionThoughtSources')
const { newThoughtNode } = await import('@craft-agent/shared/thought-workbench/types')
const { PROPOSAL_UI_TIMEOUT_MS, TaskProposal } = await import('../TaskProposal')
const { ThoughtConflictPanel } = await import('../ThoughtConflictPanel')
const { WorkbenchEditConflict } = await import('@craft-agent/shared/thought-workbench/merge')

function editorSource(): string {
  return readFileSync(join(import.meta.dir, '../TaskEditor.tsx'), 'utf8')
}

it('labels persistence as saving and switches to starting only for an explicit run', () => {
  const source = editorSource()
  expect(source).toContain("setSubmitPhase('saving')")
  expect(source.match(/setSubmitPhase\('starting'\)/g)).toHaveLength(2)
  expect(source).toContain("submitPhase === 'saving' ? 'common.saving'")
  expect(source).not.toContain("busy ? t('tasks.starting')")
})

it('distinguishes escaped Agent progress and previews from the confirmed answer', () => {
  const html = renderZh(<ThoughtGenerationOutput generation={{ id: 'g', documentId: 'd', nodeId: 'n', sessionId: 's', contextHash: 'h', status: 'running', processText: '<script>progress</script>', preview: 'unconfirmed', answer: 'committed' }} />)
  expect(html).toContain('Agent 执行过程')
  expect(html).toContain('&lt;script&gt;progress&lt;/script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('unconfirmed')
  expect(html).not.toContain('committed')
  expect(html).not.toContain('<details open')
})

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

it('keeps execution provenance collapsed and does not navigate while rendering', () => {
  let navigations = 0
  const html = renderZh(<ExecutionThoughtSources workspaceId="workspace" documentId="document" nodeId="node" onLocate={() => { navigations++ }} />)
  expect(html).toContain('<details')
  expect(html).toContain('<summary')
  expect(html).not.toContain('<ol')
  expect(navigations).toBe(0)
})

it('renders generation history without fetching or executing work while collapsed', () => {
  let requests = 0
  const html = renderZh(<ThoughtGenerationHistory documentId="doc" nodeId="node" revision="" request={async () => { requests++; throw new Error('Unexpected request') }} />)
  expect(html).toContain('<details')
  expect(html).toContain('<summary')
  expect(requests).toBe(0)
})

it('makes an unapplied answer discoverable without rendering hidden history eagerly', () => {
  const node = { ...newThoughtNode('node'), versions: [{ id: 'version', question: 'old input', answer: 'LONG_HISTORY_CONTENT', contextHash: 'hash', model: 'model', createdAt: 'now', status: 'completed' as const }] }
  const html = renderZh(<ThoughtAnswerHistory node={node} disabled={false} onApply={() => { throw new Error('Rendering must not apply an answer') }} />)
  expect(html).toContain('较新的答案已保存在版本历史中，尚未应用')
  expect(html).not.toContain('LONG_HISTORY_CONTENT')
})

it('defaults new orchestration to the thought canvas and keeps YAML import optional', () => {
  const source = editorSource()
  expect(source).toContain("thoughtEnabled ? (isEdit ? 'canvas' : 'thought') : 'definition'")
  expect(source).toContain("isEdit ? (['thought', 'canvas', 'yaml', 'results'] as Tab[]) : (['thought', 'canvas', 'yaml'] as Tab[])")
  expect(source).toContain("useState<'editor' | 'import' | 'library'>('editor')")
  expect(source).toContain('onImport={() => setPane(\'import\')}')
  expect(source).toContain("t('tasks.yamlImportTitle')")
  expect(source).toContain("t('tasks.templateLibrary')")
  expect(source).toContain('<TaskProposal')
  expect(source).toContain('<TaskApproval')
  expect(source).toContain('{(isEdit || thoughtEnabled) && <Btn variant="primary" onClick={() => submit(true)}')
  expect(source).not.toMatch(/if \(!isEdit\)[\s\S]{0,200}TaskYamlImport/)
})

it('keeps the UI proposal timeout slightly above the server generate timeout', () => {
  expect(PROPOSAL_UI_TIMEOUT_MS).toBeGreaterThan(180_000)
  expect(PROPOSAL_UI_TIMEOUT_MS).toBeLessThan(210_000)
})

it('does not treat opening the generated YAML tab as authoring a task', () => {
  const source = editorSource()
  const start = source.indexOf("if (tb === 'yaml' && shouldRefreshYamlDraft")
  expect(start).toBeGreaterThan(-1)
  const tabSwitch = source.slice(start, source.indexOf('setTab(tb)', start))
  expect(tabSwitch).toContain('setYamlDraft')
  expect(tabSwitch).not.toContain('setYamlHasLocalSource(true)')
})

it('flushes thinking-only drafts without persisting empty execution scaffolding on switch', () => {
  const source = editorSource()
  const start = source.indexOf('onBeforeSwitch={async () => {')
  expect(start).toBeGreaterThan(-1)
  const emptyDraftBranch = source.slice(start, source.indexOf('return', start))
  expect(emptyDraftBranch).toContain('!isEdit && subtasks.length === 0 && !yamlHasLocalSource')
  expect(emptyDraftBranch).toContain('thoughtController.current?.flush()')
  expect(emptyDraftBranch).not.toContain('prepareProposal(')
})

it('blocks editor dismissal and late input while a task save is pending', () => {
  const source = editorSource()
  expect(source).toContain('if (busy || submitLock.current) return')
  expect(source).toContain('if (element) element.inert = busy')
  expect(source).toContain('className="px-2" onClick={requestClose} disabled={busy}')
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

it('reveals proposal authoring when thought context is selected for an existing definition', () => {
  const base = { workspaceId: 'ws', draftIdentity: 'v1', currentYaml: 'id: existing', onApply: () => {} }
  expect(renderZh(<TaskProposal {...base} />)).not.toContain('<details open')
  expect(renderZh(<TaskProposal {...base} context="Selected thought answer" />)).toContain('<details open')
})

it('renders a conflict panel that does not choose a side while rendering', () => {
  let chosen = ''
  const html = renderZh(
    <ThoughtConflictPanel
      conflict={new WorkbenchEditConflict('/title', 'mine', 'theirs')}
      onKeepMine={() => { chosen = 'local' }}
      onKeepTheirs={() => { chosen = 'remote' }}
      onDismiss={() => { chosen = 'dismiss' }}
    />,
  )
  expect(html).toContain('thought-conflict-panel')
  expect(html).toContain('编辑冲突')
  expect(html).toContain('mine')
  expect(html).toContain('theirs')
  expect(html).toContain('保留当前')
  expect(html).toContain('保留已保存')
  expect(html).toContain('不会保存任务或启动运行')
  expect(chosen).toBe('')
})

it('keeps the empty-draft proposal shut on the thought canvas', () => {
  expect(renderZh(<TaskProposal workspaceId="ws" draftIdentity="{}" collapsed onApply={() => {}} />)).not.toContain('<details open')
  expect(editorSource()).toContain('collapsed={thoughtEnabled && tab === \'thought\' && !thoughtContext}')
  expect(editorSource()).toContain('tab !== \'thought\' && (')
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
