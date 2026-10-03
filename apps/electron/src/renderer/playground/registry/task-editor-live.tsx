import * as React from 'react'
import { parse as parseYaml } from 'yaml'
import { TaskEditor } from '@/components/app-shell/kanban/TaskEditor'
import { ModalProvider } from '@/context/ModalContext'
import { parseTaskSpec } from '../../../../../../packages/shared/src/tasks/schema'
import { validateTaskSpec } from '../../../../../../packages/shared/src/tasks/validate'
import type { TaskGenerateRequest, TaskGenerateResult } from '@craft-agent/shared/protocol'
import type { ComponentEntry } from './types'
import { mockElectronAPI } from '../mock-utils'

const initial = {
  schema_version: 3, id: 'research-report', title: '资料研究与报告', goal: '收集、分析并输出报告', acceptance_criteria: '报告引用收集资料，并说明资料限制。', runner: 'conduct',
  defaults: { model: 'gpt-6-luna', llmConnection: 'preview', permissionMode: 'safe' },
  nodes: [
    { id: 'collect', title: '收集资料', prompt: '收集约定资料，只读文件。', model: 'gpt-6-luna', llmConnection: 'preview' },
    { id: 'analyze', title: '分析资料', prompt: '分析资料 ${nodes.collect.output}', depends_on: ['collect'] },
    { id: 'report', title: '输出报告', prompt: 'Write a report from ${nodes.analyze.output}', depends_on: ['analyze'] },
  ],
}

/** Actual editor and validators, with fixed transport; the real model is tested by the host script. */
function TaskEditorLive({ mode = 'edit', response = 'normal' }: { mode?: 'create' | 'edit'; response?: 'normal' | 'invalid' | 'delayed' }) {
  const [ready, setReady] = React.useState(false)
  const [requests, setRequests] = React.useState<TaskGenerateRequest[]>([])
  const [writes, setWrites] = React.useState({ saves: 0, creates: 0, runs: 0 })
  const [closed, setClosed] = React.useState(false)
  React.useEffect(() => {
    const listeners = new Set<(workspaceId: string, result: TaskGenerateResult) => void>()
    let count = 0
    const validate = (yaml: string) => {
      try {
        const parsed = parseTaskSpec(parseYaml(yaml))
        if (!parsed.success) return { valid: false, errors: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message, severity: 'error' as const })), warnings: [] }
        return { ...validateTaskSpec(parsed.data), spec: parsed.data }
      } catch (error) { return { valid: false, errors: [{ path: 'yaml', message: String(error), severity: 'error' as const }], warnings: [] } }
    }
    Object.assign(window.electronAPI, {
      getProjects: async () => [], onProjectsChanged: () => () => {}, onTaskRunChanged: () => () => {},
      getTask: async () => ({ slug: initial.id, spec: structuredClone(initial), yaml: JSON.stringify(initial), etag: 'preview-v1', sourceVersion: 3 }),
      getTaskResults: async () => ({ slug: initial.id, runs: [], nodes: [] }),
      validateTask: async (_ws: string, yaml: string) => validate(yaml),
      onTaskGenerated: (listener: (ws: string, result: TaskGenerateResult) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      generateTask: async (_ws: string, req: TaskGenerateRequest) => {
        setRequests(previous => [...previous, structuredClone(req)])
        const id = `proposal-${++count}`
        const current = req.currentYaml ? parseYaml(req.currentYaml) : undefined
        const spec = structuredClone(current?.nodes?.length ? current : initial)
        if (req.goal.includes('去重')) {
          spec.nodes = spec.nodes.filter((node: { id: string }) => node.id !== 'dedup')
          spec.nodes.splice(1, 0, { id: 'dedup', title: '资料去重', prompt: '去重 ${nodes.collect.output}', depends_on: ['collect'] })
          const analyze = spec.nodes.find((node: { id: string }) => node.id === 'analyze')
          analyze.prompt = '分析资料 ${nodes.dedup.output}'; analyze.depends_on = ['dedup']
        }
        if (req.goal.includes('中文')) spec.nodes.find((node: { id: string }) => node.id === 'report').prompt = '用中文输出报告，依据 ${nodes.analyze.output}'
        if (req.goal.includes('删除')) {
          spec.nodes = spec.nodes.filter((node: { id: string }) => node.id !== 'dedup')
          const analyze = spec.nodes.find((node: { id: string }) => node.id === 'analyze')
          analyze.prompt = '分析资料 ${nodes.collect.output}'; analyze.depends_on = ['collect']
        }
        if (response === 'invalid') spec.nodes[1].depends_on = ['missing']
        const yaml = JSON.stringify(spec)
        const result = { orchestratorSessionId: id, slug: spec.id, spec, yaml, validation: validate(yaml) }
        if (response === 'delayed') setTimeout(() => listeners.forEach(listener => listener('preview', result)), 2500)
        else listeners.forEach(listener => listener('preview', result)) // Exercise event-before-ack handling.
        return { orchestratorSessionId: id }
      },
      deleteSession: async () => {},
      saveTask: async (_ws: string, req: { yaml: string }) => { setWrites(previous => ({ ...previous, saves: previous.saves + 1 })); return { slug: initial.id, validation: validate(req.yaml), etag: 'preview-v2', yaml: req.yaml, spec: parseYaml(req.yaml), sourceVersion: 3 } },
      createTask: async (_ws: string, req: { yaml: string }) => { setWrites(previous => ({ ...previous, creates: previous.creates + 1 })); return { slug: initial.id, orchestratorSessionId: 'preview-root', validation: validate(req.yaml) } },
      runTask: async () => { setWrites(previous => ({ ...previous, runs: previous.runs + 1 })); throw new Error('This transport preview does not execute workflows') },
      listTaskTemplates: async () => [],
      saveTaskTemplate: async () => ({ id: 'preview-template' }),
    })
    setReady(true); setRequests([]); setWrites({ saves: 0, creates: 0, runs: 0 }); setClosed(false)
    return () => { listeners.clear(); Object.assign(window.electronAPI, mockElectronAPI) }
  }, [mode, response])
  return <ModalProvider><div className="flex h-[760px] w-full min-w-0 flex-col" data-live-task-editor>
    <div data-editor-writes className="shrink-0 px-3 py-1 text-xs text-muted-foreground">固定传输验收 · 保存 {writes.saves} / 创建 {writes.creates} / 运行 {writes.runs}</div>
    {ready && !closed && <div className="min-h-0 flex-1"><TaskEditor key={`${mode}:${response}`} workspaceId="preview" target={mode === 'edit' ? { mode: 'edit', sessionId: 'preview-root', taskSlug: initial.id } : { mode: 'create' }} onClose={() => setClosed(true)}
      modelGroups={[{ provider: 'openai', label: 'OpenAI', models: [{ id: 'gpt-6-luna', name: 'GPT 6 Luna' }, { id: 'gpt-6-sol', name: 'GPT 6 Sol' }] }]}
      modelToConnection={new Map([['gpt-6-luna', 'preview'], ['gpt-6-sol', 'preview']])} defaultModel="gpt-6-luna" /></div>}
    <details className="shrink-0 px-3 text-xs"><summary>传输请求证据</summary><pre data-editor-requests className="max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(requests, null, 2)}</pre></details>
  </div></ModalProvider>
}
export const taskEditorLiveComponents: ComponentEntry[] = [{ id: 'task-editor-live', name: '实际编排编辑器', category: 'Kanban', description: '实际 TaskEditor、对话提案和图组件，固定传输记录保存/创建/运行及请求。', component: TaskEditorLive, props: [
  { name: 'mode', control: { type: 'select', options: ['create', 'edit'].map(value => ({ label: value, value })) }, defaultValue: 'edit' },
  { name: 'response', control: { type: 'select', options: ['normal', 'invalid', 'delayed'].map(value => ({ label: value, value })) }, defaultValue: 'normal' },
], layout: 'top' }]
