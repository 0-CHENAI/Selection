import * as React from 'react'
import type { ComponentEntry } from './types'
import type { OfficePreviewOperation, OfficePreviewResult } from '@craft-agent/shared/protocol'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { useOfficePreview } from '@/hooks/useOfficePreview'
import { OfficeCollaborationButton } from '@/components/app-shell/input/OfficeCollaborationButton'

/** Real button, chooser, sandbox and lifecycle with deterministic preview RPC. */
function OfficeCollaborationPreview() {
  const base = useAppShellContext()
  const [sessionId] = React.useState(() => `office-chooser-qa-${crypto.randomUUID()}`)
  const [fileCount, setFileCount] = React.useState(1)
  const [openCalls, setOpenCalls] = React.useState(0)
  const files = React.useMemo(() => fileCount > 5 ? Array.from({ length: fileCount }, (_, index) => `/demo/reports/report-${index + 1}.docx`)
    : ['/demo/report.docx', '/demo/budget.xlsx', '/demo/slides.pptx', '/demo/archive/report.docx',
      '/demo/长路径资料目录/用于验证卡片布局和完整路径的很长文件名称与数据汇总报表.xlsx'].slice(0, fileCount), [fileCount])
  const filesRef = React.useRef(files)
  filesRef.current = files
  const restoreAPI = React.useRef<() => void>()
  const preview = useOfficePreview(sessionId, base.activeWorkspaceId)
  React.useLayoutEffect(() => {
    const previous = { officePreview: window.electronAPI.officePreview, getOfficeFiles: window.electronAPI.getOfficeFiles,
      onReconnected: window.electronAPI.onReconnected, onSessionEvent: window.electronAPI.onSessionEvent }
    Object.assign(window.electronAPI, {
      getOfficeFiles: async () => filesRef.current,
      onReconnected: () => () => {}, onSessionEvent: () => () => {},
      officePreview: async (operation: OfficePreviewOperation): Promise<OfficePreviewResult | void> => {
        if (operation.type !== 'open') return
        // Browser automation can change visibility between actions. Resuming
        // an existing preview is separate from selecting a new document.
        if (!operation.previewId) setOpenCalls(count => count + 1)
        return { previewId: `preview-${operation.path}`, artifactId: operation.path, baseVersion: 'v1', path: operation.path,
          html: `<html><body style="font:16px system-ui;padding:32px"><h1 data-path="/body/1">${operation.path.split('/').pop()}</h1><p data-path="/body/2">先选择文件，再打开 Office 预览。</p></body></html>` }
      },
    })
    restoreAPI.current = () => Object.assign(window.electronAPI, previous)
  }, [])
  // The hook releases its previews before the mock API is restored.
  React.useEffect(() => () => restoreAPI.current?.(), [])
  const toggle = () => {
    if (preview.isOpen || preview.isChoosing) preview.close()
    else void preview.open(sessionId, '', files, true)
  }
  const context = { ...base, officeCollaboration: {
    sessionId, available: true, active: preview.isOpen, choosing: preview.isChoosing, onToggle: toggle,
  } }
  return <AppShellProvider value={context}>
    <div className="flex flex-col gap-3" data-office-chooser-qa>
      <div className="flex items-center gap-4 text-xs">
        <button type="button" onClick={() => setFileCount(1)}>单文件</button>
        <button type="button" onClick={() => setFileCount(5)}>多文件</button>
        <button type="button" onClick={() => setFileCount(40)}>大量文件</button>
        <button type="button" onClick={() => setFileCount(0)}>空列表</button>
        <span data-office-qa-open-calls={openCalls}>预览调用 {openCalls}</span>
        <button type="button" onClick={() => void preview.open(sessionId, '', files)}>旧命令选择框</button>
      </div>
      <div className="flex h-[520px] w-[800px] max-w-full min-w-0" data-office-chooser-layout>
        <div className="flex min-w-0 flex-1 flex-col justify-end gap-3 rounded-xl bg-background p-4">
          <div className="text-sm text-muted-foreground">当前会话</div>
          <div className="flex justify-end"><OfficeCollaborationButton sessionId={sessionId} /></div>
          <textarea aria-label="聊天草稿" placeholder="正常聊天仍可继续" className="h-24 resize-none rounded-lg bg-foreground/5 p-3 text-sm" />
        </div>
        {preview.panel}
        {preview.picker}
      </div>
    </div>
  </AppShellProvider>
}

export const officeCollaborationComponents: ComponentEntry[] = [{
  id: 'office-collaboration-chooser', name: 'Office 协同文件选择', category: 'Chat',
  description: '实际协同按钮、右侧选择界面和预览状态，RPC 使用固定数据，不启动 OfficeCLI。',
  component: OfficeCollaborationPreview, props: [], layout: 'top',
}]
