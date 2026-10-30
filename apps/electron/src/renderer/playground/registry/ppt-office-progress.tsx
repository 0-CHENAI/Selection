import * as React from 'react'
import { useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { TooltipProvider } from '@craft-agent/ui'
import { ResponseArtifacts, UserMessageBubble } from '@craft-agent/ui/chat'
import type { PptCatalog, PptPageProgress } from '@craft-agent/shared/protocol'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { sessionAtomFamily } from '@/atoms/sessions'
import { ChatInputZone } from '@/components/app-shell/input/ChatInputZone'
import { PptRevisionContext } from '@/components/ppt/ppt-revision'
import { PptArtifactScope } from '@/components/ppt/PptResultCard'
import type { Session } from '../../../shared/types'
import type { ComponentEntry } from './types'

const SESSION_ID = 'ppt-office-progress'
const PPTX = '/sessions/ppt-office-progress/项目介绍.pptx'
const SHOWN_AT = new Date(2026, 9, 27, 11, 54).getTime()

if (typeof window !== 'undefined') {
  const api = window.electronAPI as { getPptCatalog?: () => Promise<PptCatalog> } | undefined
  if (api && !api.getPptCatalog) api.getPptCatalog = async () => ({
    templates: [{ id: 'paper', title: '简洁纸张', category: '商务', canvas: '16:9', pages: 15, cover: '', referencePages: [] }],
    themes: [{ id: 'ink', name: '墨蓝', paper: '#ffffff', ink: '#172334', accent: '#205377', signal: '#cc4433' }],
  })
}

function pages(done: boolean): PptPageProgress[] {
  return Array.from({ length: 15 }, (_, index) => ({
    index: index + 1,
    id: `p${index + 1}`,
    name: index === 5 ? '市场机会' : `第${index + 1}页`,
    status: done || index < 5 ? 'passed' : index === 5 ? 'fixing' : 'pending',
    issueCount: 0,
  }))
}

function previewSession(phase: 'generating' | 'completed' | 'attention'): Session {
  const done = phase !== 'generating'
  return {
    id: SESSION_ID,
    workspaceId: 'playground-workspace',
    name: '项目介绍',
    ppt: {},
    isProcessing: !done,
    model: 'Laufry',
    llmConnection: 'fixture',
    messages: [{
      id: 'a1',
      role: 'assistant',
      turnId: 't1',
      content: '',
      timestamp: SHOWN_AT,
      artifactVersions: [{ path: PPTX, versionId: 'v1', ordinal: 1, change: 'created' as const }],
    }],
    pptProgress: done
      ? { fileName: '项目介绍.pptx', pptxPath: PPTX, total: 15, completed: 15, generating: false, pages: pages(true).map(page => phase === 'attention' && page.index === 6 ? { ...page, status: 'needs_revision', issueCount: 1, issues: [{ code: 'overflow', elementId: 'market-title', message: '市场机会标题超出页面边界' }] } : page) }
      : { fileName: '项目介绍.pptx', pptxPath: PPTX, total: 15, completed: 5, current: 6, currentTitle: '市场机会', generating: true, pages: pages(false) },
  } as Session
}

/** Real composer, Office button and deliverable row. Generation keeps the row out of the column. */
export function PptOfficeProgressPreview({ phase = 'generating' }: { phase?: 'generating' | 'completed' | 'attention' }) {
  const { t, i18n: instance } = useTranslation()
  const [languageReady, setLanguageReady] = React.useState(instance.resolvedLanguage === 'zh-Hans')
  const base = useAppShellContext()
  const store = useStore()
  const [open, setOpen] = React.useState(true)
  const [toggles, setToggles] = React.useState(0)
  const [stops, setStops] = React.useState(0)
  const [revision, setRevision] = React.useState('')
  const [revisionCount, setRevisionCount] = React.useState(0)
  const session = React.useMemo(() => previewSession(phase), [phase])
  React.useLayoutEffect(() => {
    const previous = instance.language
    let active = true
    void instance.changeLanguage('zh-Hans').then(() => { if (active) setLanguageReady(true) })
    return () => { active = false; void instance.changeLanguage(previous) }
  }, [instance])
  React.useLayoutEffect(() => {
    store.set(sessionAtomFamily(SESSION_ID), session)
  }, [store, session])
  const context = React.useMemo(() => ({
    ...base,
    llmConnections: [{
      slug: 'fixture', name: 'Fixture', providerType: 'pi' as const, piAuthProvider: 'openai' as const,
      authType: 'api_key' as const, isAuthenticated: true, createdAt: 0, defaultModel: 'Laufry', models: ['Laufry'],
    }],
    workspaceDefaultLlmConnection: 'fixture',
    officeCollaboration: {
      sessionId: SESSION_ID,
      available: true,
      active: open,
      choosing: false,
      onToggle: () => { setOpen(value => !value); setToggles(count => count + 1) },
    },
  }), [base, open])
  const artifact = { path: PPTX, name: '项目介绍.pptx', extension: 'pptx' }
  if (!languageReady) return null
  return <AppShellProvider value={context}><TooltipProvider delayDuration={200}>
    <div data-ppt-office-progress={phase} data-toggle-count={toggles} data-stop-count={stops} className="mx-auto flex w-full max-w-[840px] flex-col bg-background px-5 py-6 text-foreground">
      <UserMessageBubble
        content="使用这个模板来介绍下我这个项目。你被允许使用外部绘图skills来进行图表的绘制"
        timestamp={SHOWN_AT}
      />
      <PptRevisionContext.Provider value={async (_text, value) => { setRevision(JSON.stringify(value)); setRevisionCount(count => count + 1); return true }}>
      <PptArtifactScope session={session}>
        <ResponseArtifacts artifacts={[artifact]} anchors={['a1']} mode="settled" />
      </PptArtifactScope>
      </PptRevisionContext.Provider>
      <output data-testid="ppt-revision-result" data-count={revisionCount}>{revision}</output>
      <ChatInputZone
        sessionId={SESSION_ID}
        permissionMode="allow-all"
        sessionLabels={[]}
        labels={[]}
        sessionStatuses={[]}
        inputProps={{
          pptMode: true,
          placeholder: t('ppt.placeholder'),
          isProcessing: phase === 'generating',
          onSubmit: () => {},
          onStop: () => setStops(count => count + 1),
          currentModel: 'Laufry',
          onModelChange: () => {},
          inputValue: '',
          onInputChange: () => {},
        }}
      />
    </div>
  </TooltipProvider></AppShellProvider>
}

export const pptOfficeProgressComponents: ComponentEntry[] = [{
  id: 'ppt-office-progress',
  name: 'PPT 进度并入 Office 协同',
  category: 'Chat',
  description: '生成中不出现成果文件行，进度画在「Office 协同」按钮上。',
  component: PptOfficeProgressPreview,
  props: [{
    name: 'phase',
    control: { type: 'select', options: [{ label: '生成中', value: 'generating' }, { label: '已完成', value: 'completed' }] },
    defaultValue: 'generating',
  }],
  variants: [
    { name: 'generating', description: '生成中', props: { phase: 'generating' } },
    { name: 'completed', description: '已完成', props: { phase: 'completed' } },
    { name: 'attention', description: '按诊断问题修订', props: { phase: 'attention' } },
  ],
  layout: 'full',
}]
