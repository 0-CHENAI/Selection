import * as React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useSetAtom, useStore } from 'jotai'
import {
  Inbox, FolderKanban, Presentation, DatabaseZap, Sparkles, Webhook, Settings, Globe, FolderOpen, Clock, Radio,
  Search, Plus, Eye, Check, MoreHorizontal, X, Palette, ImagePlus, RectangleHorizontal, ArrowLeftRight, LoaderCircle,
  MousePointer2, Upload, ChevronRight, Paperclip,
} from 'lucide-react'
import { TopBar } from '@/components/app-shell/TopBar'
import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'
import { SessionItem } from '@/components/app-shell/SessionItem'
import { BoardListToggle } from '@/components/app-shell/kanban/BoardListToggle'
import { ChatInputZone } from '@/components/app-shell/input'
import { FreeFormInputContextBadge } from '@/components/app-shell/input/FreeFormInputContextBadge'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Button } from '@/components/ui/button'
import { SquarePenRounded } from '@/components/icons/SquarePenRounded'
import { McpIcon } from '@/components/icons/McpIcon'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import ChatPage from '@/pages/ChatPage'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { SessionListProvider } from '@/context/SessionListContext'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { FocusProvider } from '@/context/FocusContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { sessionAtomFamily, sessionMetaMapAtom, loadedSessionsAtom, extractSessionMeta } from '@/atoms/sessions'
import { createMockContext } from '@/playground/registry/session-list'
import { defaultSessionOptions, type SessionOptions } from '@/hooks/useSessionOptions'
import { cn } from '@/lib/utils'
import { MockSlotsContext, type MockSlots } from './slots'
import { TiltedTemplate, MenuDot, FakeCursor, spring, dshEase, DSH, ATTACH_CARD, attachTrail } from './tilt'
import { TEMPLATES, byId, THEMES, CATEGORIES, HOME_ORDER, HISTORY, DECK, type Tpl } from './data'

type Screen = 'home' | 'selected' | 'generating' | 'chat' | 'edit' | 'empty' | 'anim'
const SCREEN = (new URLSearchParams(location.search).get('screen') || 'home') as Screen
const IS_PRO_VIEW = SCREEN !== 'chat'
const GAP = 6, RADIUS_INNER = 10, RADIUS_EDGE = 14
const SELECTED_TPL = 'ppt169_china_economy_2025_briefing'
const USER_TEXT = '给公司管理层做一份十几页的 2025 年宏观经济简报，重点讲增长、消费和外贸，结论放最后一页，语气稳重一点。'
const FILE_NAME = '2025年国民经济和社会发展统计公报.pdf'

const connections = [{ slug: 'deepseek', name: 'DeepSeek', providerType: 'pi', piAuthProvider: 'deepseek', authType: 'api_key', createdAt: 0, isAuthenticated: true, isDefault: true, defaultModel: 'deepseek-v4',
  models: [{ id: 'deepseek-v4', name: 'DeepSeek V4', shortName: 'DeepSeek V4', description: '', provider: 'pi', contextWindow: 128000 }] }]

// ---------------------------------------------------------------- Shell
function TrafficLights() {
  return <div className="fixed left-[18px] top-[17px] z-[60] flex gap-2 pointer-events-none">
    {['#FF5F57', '#FEBC2E', '#28C840'].map(c => <span key={c} className="h-3 w-3 rounded-full" style={{ background: c, boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.12)' }} />)}
  </div>
}

function Shell({ sidebar, navigator, content, office, immersive, topBarExtra }: {
  sidebar?: React.ReactNode; navigator?: React.ReactNode; content: React.ReactNode; office?: React.ReactNode; immersive?: boolean; topBarExtra?: React.ReactNode
}) {
  const base0 = useAppShellContext()
  const base = { ...base0, workspaces: base0.workspaces.map(w => ({ ...w, name: '我的工作区' })) }
  return <div className="h-screen w-screen overflow-hidden flex flex-col text-foreground" style={{ paddingTop: 'var(--topbar-height)' }}>
    <TrafficLights />
    <TopBar workspaces={base.workspaces} activeWorkspaceId={base.activeWorkspaceId} onSelectWorkspace={() => {}}
      onNewChat={() => {}} onOpenSettings={() => {}} onOpenSettingsSubpage={() => {}} onOpenKeyboardShortcuts={() => {}} onOpenStoredUserPreferences={() => {}}
      onBack={() => {}} onForward={() => {}} canGoBack canGoForward={false} onToggleSidebar={() => {}} onToggleFocusMode={() => {}} immersive={immersive}
      afterWorkspace={topBarExtra} />
    <div className="flex flex-1 min-h-0">
      <div className="min-w-0 flex-1 flex items-stretch relative" style={{ paddingRight: office ? 0 : GAP, paddingBottom: GAP, gap: GAP, paddingLeft: immersive ? GAP : 0 }}>
        {!immersive && <div className="h-full shrink-0" style={{ width: 220 }}>{sidebar}</div>}
        {!immersive && <div className="h-full shrink-0 overflow-hidden relative bg-background shadow-middle z-[2]" style={{ width: 300, borderRadius: RADIUS_INNER }}>{navigator}</div>}
        <div data-panel-role="content" className="h-full min-w-0 flex-1 overflow-hidden relative @container/panel shadow-middle bg-foreground-2"
          style={{ borderTopLeftRadius: RADIUS_INNER, borderTopRightRadius: RADIUS_INNER, borderBottomLeftRadius: immersive ? RADIUS_EDGE : RADIUS_INNER, borderBottomRightRadius: office ? RADIUS_INNER : RADIUS_EDGE }}>
          <div className="h-full flex flex-col overflow-hidden rounded-[inherit]">{content}</div>
        </div>
      </div>
      {office && <div className="relative z-panel flex h-full min-h-0 shrink-0" style={{ width: 640 }}>
        <div className="relative h-full min-h-0 min-w-0 flex-1" style={{ marginLeft: GAP, paddingRight: GAP, paddingBottom: GAP }}>{office}</div>
      </div>}
    </div>
  </div>
}

function Sidebar({ active }: { active: 'ppt' | 'chat' }) {
  const { t } = useTranslation()
  const ghost = 'ghost' as const
  const links: any[] = [
    { id: 'nav:allSessions', title: t('sidebar.allSessions'), label: '24', icon: Inbox, variant: active === 'chat' ? 'default' : ghost, onClick: () => {} },
    { id: 'nav:projects', title: t('sidebar.projects'), label: '3', icon: FolderKanban, variant: ghost, onClick: () => {}, expandable: true, expanded: false, onToggle: () => {} },
    { id: 'nav:ppt', title: 'PPT', label: String(HISTORY.length), icon: Presentation, variant: active === 'ppt' ? 'default' : ghost, onClick: () => {} },
    { id: 'separator:chats-sources', type: 'separator' },
    { id: 'nav:sources', title: t('sidebar.sources'), label: '5', icon: DatabaseZap, variant: ghost, onClick: () => {}, expandable: true, expanded: false, onToggle: () => {},
      items: [{ id: 'a', title: t('sidebar.apis'), icon: Globe, variant: ghost }, { id: 'b', title: t('sidebar.mcps'), icon: <McpIcon className="h-3.5 w-3.5" />, variant: ghost }, { id: 'c', title: t('sidebar.localFolders'), icon: FolderOpen, variant: ghost }] },
    { id: 'nav:skills', title: t('sidebar.skills'), label: '12', icon: Sparkles, variant: ghost, onClick: () => {} },
    { id: 'nav:automations', title: t('sidebar.automations'), label: '2', icon: Webhook, variant: ghost, onClick: () => {}, expandable: true, expanded: false, onToggle: () => {},
      items: [{ id: 'd', title: t('sidebar.scheduled'), icon: Clock, variant: ghost }, { id: 'e', title: t('sidebar.eventBased'), icon: Radio, variant: ghost }] },
    { id: 'separator:skills-settings', type: 'separator' },
    { id: 'nav:settings', title: t('sidebar.settings'), icon: Settings, variant: ghost, onClick: () => {} },
  ]
  return <div className="h-full font-sans relative"><div className="flex h-full flex-col select-none"><div className="flex-1 flex flex-col min-h-0">
    <div className="px-2 pb-2 shrink-0"><div>
      <Button variant="ghost" className="w-full justify-start gap-2 py-[7px] px-2 text-[13px] font-normal rounded-[6px] shadow-minimal bg-background">
        {active === 'ppt' ? <Plus className="h-3.5 w-3.5 shrink-0" /> : <SquarePenRounded className="h-3.5 w-3.5 shrink-0" />}
        {active === 'ppt' ? '新建 PPT' : t('session.newSession')}
      </Button>
    </div></div>
    <div className="flex-1 overflow-y-auto min-h-0 mask-fade-bottom pb-4"><LeftSidebar isCollapsed={false} links={links} /></div>
  </div></div></div>
}

// ---------------------------------------------------------------- PPT navigator
function PptHistoryRow({ item, selected, generating }: { item: typeof HISTORY[number]; selected?: boolean; generating?: boolean }) {
  return <div className="relative group select-none pl-2 mr-2">
    {selected && <div className="absolute left-0 inset-y-0 w-[2px] bg-accent" />}
    <button className={cn('flex w-full items-center gap-3 pl-2 pr-3 py-2.5 text-left text-sm outline-none rounded-[8px] transition-[background-color] duration-75', selected ? 'bg-foreground/3' : 'hover:bg-foreground/2')}>
      <div className="relative h-[38px] w-[66px] shrink-0 overflow-hidden rounded-[5px] bg-foreground/5 shadow-minimal">
        <img src={item.thumb} className="h-full w-full object-cover" />
        {generating && <div className="absolute inset-0 flex items-center justify-center bg-background/55 backdrop-blur-[1px]"><LoaderCircle className="size-3.5 animate-spin text-accent" /></div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[13px] font-sans', generating && 'animate-shimmer-text')}>{item.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground/40">
          <span>{generating ? '生成中 · 第 9/17 页' : `${item.pages} 页`}</span>
        </div>
      </div>
      <span className="self-start pt-0.5 text-[11px] text-foreground/40 whitespace-nowrap">{item.time}</span>
    </button>
  </div>
}

function PptNavigator({ selected, generating, empty }: { selected?: string; generating?: boolean; empty?: boolean }) {
  const groups: [string, typeof HISTORY][] = [['今天', HISTORY.slice(0, 2)], ['本周', HISTORY.slice(2, 5)], ['更早', HISTORY.slice(5)]]
  return <div className="h-full flex flex-col min-w-0">
    <PanelHeader title="PPT" titleAlign="start" actions={<HeaderIconButton icon={<Plus className="h-4 w-4" />} tooltip="新建 PPT" />} />
    <SessionSearchHeader searchQuery="" placeholder="搜索 PPT" readOnly />
    {empty ? <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-foreground/[0.04] text-muted-foreground"><Presentation className="size-6" strokeWidth={1.5} /></div>
      <p className="text-sm font-medium">暂无 PPT</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">选一个模板，上传资料或写下要求，AI 会帮你做成可编辑的 PPTX。</p>
      <Button variant="ghost" className="mt-4 gap-1.5 h-8 px-3 text-[13px] rounded-[6px] shadow-minimal bg-background"><Plus className="size-3.5" />新建 PPT</Button>
    </div> :
    <div className="flex-1 overflow-y-auto pb-4">
      {groups.map(([label, items]) => <div key={label}>
        <div className="px-4 pt-3 pb-1"><span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span></div>
        {items.map(item => <PptHistoryRow key={item.id} item={item} selected={item.id === selected} generating={generating && item.id === 'h1'} />)}
      </div>)}
    </div>}
  </div>
}

// ---------------------------------------------------------------- Gallery
function TemplateCard({ tpl, hovered, selected, compact, pressed }: { tpl: Tpl; hovered?: boolean; selected?: boolean; compact?: boolean; pressed?: boolean }) {
  return <div className="group/card min-w-0 cursor-pointer">
    <div data-tpl-card={tpl.id} style={{ transform: pressed ? 'scale(.985)' : hovered ? 'translateY(-1px)' : undefined }} className={cn('relative aspect-[16/9] overflow-hidden rounded-[8px] bg-foreground/[0.04] shadow-minimal transition-shadow',
      selected && 'ring-2 ring-accent ring-offset-2 ring-offset-background', hovered && !selected && 'ring-1 ring-foreground/15 shadow-middle')}>
      <img src={tpl.thumb} className={cn('h-full w-full', tpl.canvas === '16:9' || tpl.canvas === '1920×1080' ? 'object-cover' : 'object-contain')} />
      {(hovered || selected) && <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />}
      {hovered && <button className="absolute right-1.5 top-1.5 inline-flex h-7 items-center gap-1 rounded-full bg-background/95 pl-2 pr-2.5 text-[11px] font-medium text-foreground shadow-minimal ring-1 ring-border/50 backdrop-blur-sm">
        <Eye className="size-3.5" />逐页预览</button>}
      {selected && <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-white shadow-minimal"><Check className="size-3" strokeWidth={3} /></span>}
      {tpl.canvas !== '16:9' && <span className="absolute left-1.5 bottom-1.5 rounded-[4px] bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">{tpl.canvas}</span>}
    </div>
    <div className={cn('px-0.5', compact ? 'pt-1.5' : 'pt-2')}>
      <div className={cn('truncate font-medium text-foreground', compact ? 'text-[12px]' : 'text-[13px]')}>{tpl.title}</div>
      {!compact && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{tpl.cat} · {tpl.pages} 页</div>}
    </div>
  </div>
}

function CategoryTabs({ active = '全部', size = 'md' }: { active?: string; size?: 'md' | 'sm' }) {
  const count = (c: string) => c === '全部' ? TEMPLATES.length : c === '自定义' ? 0 : TEMPLATES.filter(t => t.cat === c).length
  return <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
    {CATEGORIES.map(c => <button key={c} className={cn('shrink-0 inline-flex items-center gap-1 rounded-[6px] whitespace-nowrap transition-colors', size === 'md' ? 'h-7 px-2.5 text-[13px]' : 'h-6 px-2 text-[12px]',
      c === active ? 'bg-foreground/[0.06] font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground')}>
      {c === '自定义' && <Upload className="size-3" />}{c}{c !== '全部' && c !== '自定义' && size === 'md' && <span className="text-[11px] tabular-nums text-foreground/35">{count(c)}</span>}
    </button>)}
  </div>
}

function Gallery({ hovered, selected, cols = 4, order = HOME_ORDER, pressed }: { hovered?: string; selected?: string; cols?: number; order?: string[]; pressed?: string }) {
  const items = order.map(byId)
  return <div>
    <div className="flex items-center justify-between gap-4 pb-3">
      <CategoryTabs />
      <div className="relative w-44 shrink-0 rounded-[8px] shadow-minimal bg-muted/50">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <div className="h-7 pl-8 pr-2 text-[13px] leading-7 text-muted-foreground/50">搜索模板</div>
      </div>
    </div>
    <div className="grid gap-x-4 gap-y-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {items.map(t => <TemplateCard key={t.id} tpl={t} hovered={t.id === hovered} selected={t.id === selected} pressed={t.id === pressed} />)}
    </div>
  </div>
}

// ---------------------------------------------------------------- Composer helpers
function TemplateChip({ tpl, menuOpen }: { tpl: Tpl; menuOpen?: boolean }) {
  return <div className="relative group shrink-0 select-none">
    <div className="h-16 flex items-center gap-2.5 rounded-[8px] bg-foreground/5 pl-1.5 pr-1.5">
      <div className="h-12 w-[86px] rounded-[6px] overflow-hidden bg-background shadow-minimal shrink-0"><img src={tpl.thumb} className="h-full w-full object-cover" /></div>
      <div className="flex flex-col min-w-0 max-w-[150px]">
        <span className="text-[10px] text-muted-foreground">模板</span>
        <span className="text-xs font-medium line-clamp-2" title={tpl.title}>{tpl.title}</span>
      </div>
      <TemplateOptionsMenu open={menuOpen} />
    </div>
    <button className="absolute -top-1.5 -right-1.5 z-10 h-5 w-5 rounded-full bg-muted-foreground/90 text-background flex items-center justify-center opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></button>
  </div>
}

function TemplateOptionsMenu({ open, trigger }: { open?: boolean; trigger?: React.ReactNode }) {
  return <DropdownMenu open={open ?? false} modal={false}>
    <DropdownMenuTrigger asChild>
      {trigger ?? <button className={cn('ml-0.5 flex size-7 items-center justify-center rounded-[6px] text-foreground/60 hover:bg-foreground/[0.06]', open && 'bg-foreground/[0.08] text-foreground')} aria-label="模板选项"><MoreHorizontal className="size-4" /></button>}
    </DropdownMenuTrigger>
    <StyledDropdownMenuContent side="bottom" align="start" sideOffset={8} alignOffset={-6} className="w-[300px] p-1.5" onCloseAutoFocus={e => e.preventDefault()}>
      <div className="px-2 pt-1.5 pb-2 text-xs text-muted-foreground">可选设置，不改也行</div>
      <div className="rounded-lg px-2 py-2">
        <div className="flex items-center gap-2 text-sm"><Palette className="size-3.5 text-muted-foreground" /><span className="flex-1">主题色</span><span className="text-xs text-muted-foreground">跟随模板</span></div>
        <div className="mt-2.5 grid grid-cols-7 gap-1.5 pl-[22px]">
          <span title="跟随模板" className="flex size-7 items-center justify-center rounded-full ring-2 ring-accent ring-offset-1 ring-offset-background bg-[conic-gradient(#123B57_0_50%,#F4F1EA_0)]"><Check className="size-3 text-white mix-blend-difference" strokeWidth={3} /></span>
          {THEMES.map(th => <span key={th.id} title={th.name} className="relative size-7 overflow-hidden rounded-full shadow-minimal ring-1 ring-black/5" style={{ background: th.paper }}>
            <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: th.accent }} />
          </span>)}
        </div>
      </div>
      <StyledDropdownMenuSeparator className="my-1" />
      <StyledDropdownMenuItem className="flex items-center gap-2 px-2 py-2 rounded-lg">
        <ImagePlus className="size-3.5 text-muted-foreground" /><span className="flex-1">品牌色与 logo</span><span className="text-xs text-muted-foreground">未设置</span><ChevronRight className="size-3.5 text-muted-foreground" />
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator className="my-1" />
      <div className="px-2 py-2">
        <div className="flex items-center gap-2 text-sm"><RectangleHorizontal className="size-3.5 text-muted-foreground" /><span className="flex-1">画幅比例</span></div>
        <div className="mt-2 ml-[22px] inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-0.5">
          {['16:9', '4:3', '1:1', '9:16', '3:4'].map(r => <span key={r} className={cn('h-6 px-2 inline-flex items-center rounded-md text-xs tabular-nums', r === '16:9' ? 'bg-background shadow-minimal font-medium text-foreground' : 'text-muted-foreground')}>{r}</span>)}
        </div>
      </div>
    </StyledDropdownMenuContent>
  </DropdownMenu>
}

function PptSkillBadge() {
  return <FreeFormInputContextBadge icon={<Presentation className="h-4 w-4" />} label="PPT" isExpanded hasSelection showChevron={false} tooltip="已启用 PPT 技能" />
}

function usePastedFile(sessionId: string, enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('craft:paste-files', { detail: { sessionId, files: [new File(['%PDF-1.4\n% mock\n'], FILE_NAME, { type: 'application/pdf' })] } }))
    }, 50)
    return () => clearTimeout(timer)
  }, [sessionId, enabled])
}

type TiltProps = Partial<React.ComponentProps<typeof TiltedTemplate>>
function PptComposer({ selected, menuOpen, withFile, text, tilt }: { selected?: Tpl; menuOpen?: boolean; withFile?: boolean; text?: string; tilt?: TiltProps }) {
  const base = useAppShellContext()
  const sessionId = 'ppt-new'
  usePastedFile(sessionId, !!withFile)
  const slots: MockSlots = { leadingAttachments: selected ? <TiltedTemplate width={ATTACH_CARD.width} pad={ATTACH_CARD.pad} trail={attachTrail()} tpl={selected} pages={[DECK[2], DECK[1]]} menu={menuOpen ? <TemplateOptionsMenu open trigger={<MenuDot open />} /> : undefined} {...tilt} /> : undefined, afterAttachBadge: <PptSkillBadge /> }
  return <MockSlotsContext.Provider value={slots}>
    <AppShellProvider value={{ ...base, isCompactMode: false, llmConnections: connections as any, workspaceDefaultLlmConnection: 'deepseek' } as any}>
      <ChatInputZone sessionId={sessionId} showOptionBadges={false} className="!px-0 !pb-0"
        inputProps={{ workMode: 'PRO', isEmptySession: true, placeholder: '描述你想要的 PPT：主题、受众、页数、风格…也可以上传文档、表格或已有 PPTX', currentModel: 'deepseek-v4', currentConnection: 'deepseek',
          inputValue: text ?? '', onInputChange: () => {}, onSubmit: () => {}, onModelChange: () => {}, thinkingLevel: 'high', onThinkingLevelChange: () => {}, sources: [], enabledSourceSlugs: [] } as any} />
    </AppShellProvider>
  </MockSlotsContext.Provider>
}

export const ANIM_ORDER = [...HOME_ORDER.slice(1, 7), HOME_ORDER[0], ...HOME_ORDER.slice(7)]
function PptHome({ selected, menuOpen, withFile, text, hovered, tilt, composerTpl, order, pressed }: { selected?: string; menuOpen?: boolean; withFile?: boolean; text?: string; hovered?: string; tilt?: TiltProps; composerTpl?: string; order?: string[]; pressed?: string }) {
  return <>
    <PanelHeader title="新建 PPT" />
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[880px] px-6 pt-6 pb-10">
        <h2 className="text-center text-[22px] font-semibold tracking-tight">今天想做一份什么样的 PPT？</h2>
        <p className="mt-1.5 mb-5 text-center text-[13px] text-muted-foreground">写下要求、上传资料，再选一个喜欢的模板。AI 会参考它的封面和版式，生成可编辑的 PPTX。</p>
        <PptComposer selected={(composerTpl ?? selected) ? byId((composerTpl ?? selected)!) : undefined} menuOpen={menuOpen} withFile={withFile} text={text} tilt={tilt} />
        <div className="mt-8"><Gallery hovered={hovered} selected={selected} order={order} pressed={pressed} /></div>
      </div>
    </div>
  </>
}

// ---------------------------------------------------------------- Chat mock sessions
function useMockSessions(kind: 'chat' | 'generating' | 'edit') {
  const store = useStore()
  const base = useAppShellContext()
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const toB64 = async (url: string) => {
        const img = new Image(); img.src = url; await img.decode()
        const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * img.naturalHeight / img.naturalWidth)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/png').split(',')[1]
      }
      const thumb = await toB64(byId(SELECTED_TPL).thumb)
      const now = Date.now()
      const ws = base.activeWorkspaceId!
      let session: any
      if (kind === 'chat') {
        session = { id: 'chat-1', name: 'Q3 华东区销售复盘', workspaceId: ws, workspaceName: 'Playground', workMode: 'NORM', lastMessageAt: now - 60_000, isProcessing: false, permissionMode: 'ask', messages: [
          { id: 'u1', role: 'user', timestamp: now - 300_000, content: '帮我梳理一下 Q3 华东区的销售复盘，数据在附件里。', attachments: [{ id: 'a1', type: 'spreadsheet', name: 'Q3华东区销售明细.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 182000, storedPath: '/mock/Q3.xlsx' }] },
          { id: 't1', role: 'tool', timestamp: now - 290_000, content: '', toolName: 'Read', toolStatus: 'completed', toolIntent: '读取 Q3华东区销售明细.xlsx', toolInput: { file_path: '/mock/Q3.xlsx' }, toolResult: 'ok' },
          { id: 'a2', role: 'assistant', timestamp: now - 280_000, content: '## Q3 华东区复盘要点\n\n1. **整体**：销售额 2.84 亿元，同比 +12.6%，完成年度目标的 78%。\n2. **结构**：上海、杭州贡献 61%，苏州增速最快（+31%）。\n3. **问题**：9 月退货率升到 4.2%，集中在两款新品。\n4. **建议**：Q4 把促销预算向苏州、宁波倾斜，并对新品做一次质检复盘。\n\n需要的话，我可以把这些整理成给管理层汇报用的 PPT。' },
        ] }
      } else {
        const done = kind === 'edit'
        session = { id: 'ppt-1', name: '2025 宏观经济简报（管理层）', workspaceId: ws, workspaceName: 'Playground', workMode: 'PRO', lastMessageAt: now, isProcessing: !done, permissionMode: 'safe', messages: [
          { id: 'u1', role: 'user', timestamp: now - 240_000, content: USER_TEXT, attachments: [
            { id: 'tpl', type: 'image', name: '模板 · 2025 年中国经济数据简报.png', mimeType: 'image/png', size: 80000, storedPath: '/mock/tpl.png', thumbnailBase64: thumb },
            { id: 'pdf', type: 'pdf', name: FILE_NAME, mimeType: 'application/pdf', size: 2400000, storedPath: '/mock/gb.pdf' },
          ] },
          { id: 't0', role: 'tool', timestamp: now - 235_000, content: '', toolName: 'Skill', toolStatus: 'completed', toolIntent: '启用 PPT 技能', toolInput: { skill: 'ppt-design' }, toolResult: 'ok' },
          { id: 't1', role: 'tool', timestamp: now - 230_000, content: '', toolName: 'Read', toolStatus: 'completed', toolIntent: `读取 ${FILE_NAME}`, toolInput: { file_path: '/mock/gb.pdf' }, toolResult: 'ok' },
          { id: 't2', role: 'tool', timestamp: now - 200_000, content: '', toolName: 'Read', toolStatus: 'completed', toolIntent: '读取模板「2025 年中国经济数据简报」的封面与版式', toolInput: { file_path: 'styles/examples/ppt169_china_economy_2025_briefing/deck.json' }, toolResult: 'ok' },
          { id: 't3', role: 'tool', timestamp: now - 160_000, content: '', toolName: 'Write', toolStatus: 'completed', toolIntent: '写出 17 页大纲与页面结构', toolInput: { file_path: '/mock/deck.json' }, toolResult: 'ok' },
          { id: 't4', role: 'tool', timestamp: now - 90_000, content: '', toolName: 'Bash', toolStatus: 'completed', toolIntent: 'deck_check：第 1–8 页预检通过', toolInput: { command: 'bun deck-cli.mjs check deck.json --pages 1-8' }, toolResult: '0 issues' },
          ...(done ? [
            { id: 't5', role: 'tool', timestamp: now - 40_000, content: '', toolName: 'Bash', toolStatus: 'completed', toolIntent: 'deck_render：导出 PPTX 并逐页截图自查', toolInput: { command: 'bun deck-cli.mjs render deck.json -o 2025宏观经济简报.pptx' }, toolResult: 'ok' },
            { id: 'a9', role: 'assistant', timestamp: now - 30_000, content: '已生成 **2025宏观经济简报.pptx**，共 17 页，右侧可以逐页查看。\n\n- 结构：封面 → 六个数字速览 → 增长 / 产业 / 人口 / 就业 → 消费 / 投资 / 外贸 → 能源与创新 → 民生 → 结论与数据来源\n- 版式沿用模板的数据新闻风格，图表都是原生图表，可以直接改数\n- 预检 0 个问题（无越界、无溢出、对比度达标）\n\n想改哪里，可以在右侧点选元素后直接告诉我。' },
          ] : [
            { id: 't5', role: 'tool', timestamp: now - 5_000, content: '', toolName: 'Bash', toolStatus: 'in_progress', toolIntent: '生成第 9 页「消费：社零总额与结构」', toolInput: { command: 'bun deck-cli.mjs render deck.json --page 9' } },
          ]),
        ] }
      }
      if (cancelled) return
      store.set(sessionMetaMapAtom, new Map([[session.id, extractSessionMeta(session)]]))
      store.set(loadedSessionsAtom, new Set([session.id]))
      store.set(sessionAtomFamily(session.id), session)
      Object.assign(window.electronAPI, {
        getWindowFocusState: async () => true, onWindowFocusChange: () => () => {},
        getDefaultThinkingLevel: async () => 'high', getWorkspaceSettings: async () => ({ permissionMode: 'safe' }),
        getAdvancedSettings: async () => ({ dagOrchestrationEnabled: false, swarmAgentsEnabled: false, anySearchApiKeyConfigured: false }),
        getSessionMessages: async (id: string) => id === session.id ? session : undefined,
      })
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [kind])
  return ready
}

function ChatProviders({ children, sessionId, draft, slots, office }: { children: React.ReactNode; sessionId: string; draft?: string; slots?: MockSlots; office?: boolean }) {
  const base = useAppShellContext()
  const [options, setOptions] = React.useState<Map<string, SessionOptions>>(() => new Map([[sessionId, { ...defaultSessionOptions, permissionMode: 'safe' } as SessionOptions]]))
  const context = { ...base, isCompactMode: false, ...(office ? { officeCollaboration: { sessionId, available: true, active: true, choosing: false, onToggle: () => {} } } : {}), sessionOptions: options, onSessionOptionsChange: (id: string, u: Partial<SessionOptions>) => setOptions(p => new Map(p).set(id, { ...defaultSessionOptions, ...p.get(id), ...u } as SessionOptions)),
    llmConnections: connections as any, workspaceDefaultLlmConnection: 'deepseek',
    getDraft: (id: string) => id === sessionId ? (draft ?? '') : '', onInputChange: () => {}, hydrateDraftAttachments: async () => [], onAttachmentsChange: () => {} }
  const listContext = createMockContext({ selectedSessionId: sessionId, onSelectSessionById: () => {} })
  return <AppShellProvider value={context as any}><ActionRegistryProvider><FocusProvider><DismissibleLayerProvider><ModalProvider>
    <NavigationProvider workspaceId={base.activeWorkspaceId} workspaceSlug="playground" onCreateSession={base.onCreateSession} isReady={false}>
      <SessionListProvider value={listContext}><MockSlotsContext.Provider value={slots ?? {}}>{children}</MockSlotsContext.Provider></SessionListProvider>
    </NavigationProvider></ModalProvider></DismissibleLayerProvider></FocusProvider></ActionRegistryProvider></AppShellProvider>
}

// ---------------------------------------------------------------- Office preview panel (mirrors useOfficePreview markup)
function OfficeAside({ mode }: { mode: 'generating' | 'edit' }) {
  const pages = DECK
  const current = 8 // 0-based → 第 9 页
  return <aside aria-label="Office 交互预览" className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-foreground-2 shadow-middle" style={{ borderRadius: RADIUS_INNER, borderBottomRightRadius: RADIUS_EDGE }}>
    <div className="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm">
      <strong className="min-w-0 truncate">2025宏观经济简报.pptx</strong>
      <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/5"><ArrowLeftRight className="size-3.5" />切换文件</button>
      <div className="ml-auto shrink-0"><HeaderIconButton icon={<X className="size-4" />} tooltip="关闭 Office 预览" /></div>
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-background">
        {mode === 'generating' ? <GeneratingStage pages={pages} current={current} /> : <EditStage pages={pages} />}
      </div>
      {mode === 'generating' && <div className="pointer-events-none absolute inset-x-3 top-4 flex justify-center">
        <div className="flex max-w-full items-center gap-2.5 rounded-full bg-background/95 px-4 py-2.5 text-accent shadow-minimal ring-1 ring-border/50 backdrop-blur-sm">
          <LoaderCircle className="size-4 shrink-0 animate-spin" />
          <div className="min-w-0"><p className="text-xs font-medium">正在生成第 9 页「消费：社零总额与结构」</p><p className="mt-0.5 text-[11px] text-muted-foreground">已完成的页面可以先看，全部完成后可点选修改</p></div>
        </div>
      </div>}
      {mode === 'edit' && <div className="pointer-events-none absolute inset-x-3 bottom-[118px] flex justify-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-background px-5 py-2.5 text-sm font-medium shadow-middle ring-1 text-accent ring-accent/25">
          <MousePointer2 className="size-4" /><span className="tabular-nums">已选 2 / 256</span>
        </div>
      </div>}
      <ThumbStrip pages={pages} current={mode === 'generating' ? current : 2} generating={mode === 'generating'} />
    </div>
  </aside>
}

function ThumbStrip({ pages, current, generating }: { pages: string[]; current: number; generating: boolean }) {
  return <div className="shrink-0 border-t border-border/50 bg-foreground-2 px-3 pt-2.5 pb-3">
    <div className="mb-2 flex items-center text-[11px] text-muted-foreground"><span>页面</span><span className="ml-auto tabular-nums">{generating ? `已完成 ${current} 页 · 共 17 页` : '共 17 页'}</span></div>
    <div className="overflow-hidden"><div className="flex gap-2" style={{ transform: `translateX(-${Math.max(0, current - 3) * 92}px)` }}>
      {pages.map((p, i) => {
        const done = !generating || i < current, active = i === current
        return <div key={p} className="shrink-0 w-[84px]">
          <div className={cn('relative aspect-[16/9] overflow-hidden rounded-[4px] bg-foreground/[0.05] shadow-minimal', active && 'ring-2 ring-accent ring-offset-1 ring-offset-background')}>
            {done && <img src={p} className="h-full w-full object-cover" />}
            {generating && active && <><img src={p} className="h-full w-full object-cover opacity-35" /><div className="absolute inset-0 flex items-center justify-center"><LoaderCircle className="size-4 animate-spin text-accent" /></div></>}
            {!done && !active && <div className="absolute inset-0 animate-pulse bg-foreground/[0.03]" />}
          </div>
          <div className={cn('mt-1 text-center text-[10px] tabular-nums', active ? 'text-accent font-medium' : 'text-muted-foreground')}>{i + 1}</div>
        </div>
      })}
    </div></div>
  </div>
}

function GeneratingStage({ pages, current }: { pages: string[]; current: number }) {
  return <div className="absolute inset-0 overflow-hidden bg-[#e9e9eb] px-6 pt-20 pb-6">
    <div className="relative mx-auto w-full max-w-[580px] overflow-hidden rounded-[2px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_24px_rgba(0,0,0,.08)]">
      <div className="aspect-[16/9] relative overflow-hidden">
        <img src={pages[current]} className="absolute inset-0 h-full w-full" style={{ clipPath: 'inset(0 0 38% 0)' }} />
        <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[#F4F1EA]">
          <div className="absolute inset-x-[5%] top-[6%] h-[10%] rounded bg-gradient-to-r from-foreground/[0.06] via-foreground/[0.03] to-foreground/[0.06] animate-pulse" />
          <div className="absolute left-[5%] top-[28%] h-[48%] w-[42%] rounded bg-foreground/[0.04] animate-pulse" />
          <div className="absolute right-[5%] top-[28%] h-[48%] w-[44%] rounded bg-foreground/[0.04] animate-pulse" />
        </div>
        <div className="absolute inset-x-0 h-[2px] bg-accent/70 shadow-[0_0_12px_rgba(139,85,39,.6)]" style={{ top: '62%' }} />
      </div>
    </div>
    <div className="mx-auto mt-3 max-w-[580px] text-center text-[11px] text-foreground/45 tabular-nums">第 9 页 · 16:9 · 960 × 540</div>
    <div className="mx-auto mt-5 max-w-[580px] opacity-90">
      <div className="mb-2 text-[11px] text-foreground/45">上一页</div>
      <div className="overflow-hidden rounded-[2px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.12)]"><img src={pages[current - 1]} className="block w-full" /></div>
    </div>
  </div>
}

function EditStage({ pages }: { pages: string[] }) {
  // OfficeCLI-style stacked slides, scrolled to slides 3–4. Two title shapes selected.
  const W = 560
  const sel = (x: number, y: number, w: number, h: number) => <div className="absolute" style={{ left: x / 1280 * W, top: y / 720 * W * 9 / 16, width: w / 1280 * W, height: h / 720 * W * 9 / 16 }}>
    <div className="absolute -inset-[3px] rounded-[2px] border-2 border-[#2563EB] bg-[#2563EB]/[0.06]" />
    {[['-left-[6px] -top-[6px]'], ['-right-[6px] -top-[6px]'], ['-left-[6px] -bottom-[6px]'], ['-right-[6px] -bottom-[6px]']].map(([c]) => <span key={c} className={`absolute ${c} size-[7px] rounded-[1px] border border-[#2563EB] bg-white`} />)}
  </div>
  return <div className="absolute inset-0 overflow-hidden bg-[#e9e9eb]">
    <div className="absolute left-1/2 -translate-x-1/2" style={{ width: W, top: -(W * 9 / 16 + 42) + 8 }}>
      {[1, 2, 3, 4].map(i => <div key={i} className="mb-5">
        <div className="mb-1.5 text-[11px] text-foreground/45 tabular-nums">{i + 1}</div>
        <div className="relative overflow-hidden rounded-[2px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_24px_rgba(0,0,0,.06)]">
          <img src={pages[i]} className="block w-full" />
          {i === 2 && sel(64, 86, 228, 52)}
          {i === 3 && sel(64, 86, 420, 52)}
        </div>
      </div>)}
    </div>
  </div>
}

// ---------------------------------------------------------------- Screens
function PptButtonBadge({ open }: { open?: boolean }) {
  return <FreeFormInputContextBadge icon={<Presentation className="h-4 w-4" />} label="PPT" isExpanded={false} hasSelection={!!open} isOpen={open} showChevron={false} tooltip="用当前对话做 PPT" />
}

function AnchoredGallery() {
  const ref = React.useRef<HTMLSpanElement>(null)
  const [pos, setPos] = React.useState<{ left: number; bottom: number } | null>(null)
  React.useLayoutEffect(() => {
    const update = () => { const r = ref.current?.parentElement?.getBoundingClientRect(); if (r) setPos({ left: r.left - 12, bottom: innerHeight - r.top + 10 }) }
    update(); const t = setInterval(update, 300); return () => clearInterval(t)
  }, [])
  return <><span ref={ref} />{pos && createPortal(<div className="fixed z-50" style={{ left: pos.left, bottom: pos.bottom }}><GalleryPopover /></div>, document.body)}</>
}

function GalleryPopover() {
  const items = ['ppt169_china_economy_2025_briefing', 'ppt169_solar_cheapest_power', 'dsh-cartesian', 'ppt169_global_ai_capital_2026', 'ppt169_container_shipping_editorial', 'ppt169_apple_fy2025_review', 'ppt169_taiwan_super_aged_society_zh_hant', 'ppt169_nev_export_bilingual_zh_en', 'ppt169_china_rail_2024_zh'].map(byId)
  return <div className="w-[560px] rounded-[12px] bg-background text-foreground shadow-modal-small ring-1 ring-border p-3">
    <div className="flex items-center gap-2 px-1 pb-1">
      <Presentation className="size-4 text-muted-foreground" />
      <strong className="text-sm font-medium flex-1">用这段对话做 PPT</strong>
      <span className="text-[11px] text-muted-foreground">将以 PRO 会话运行，带上当前对话和附件</span>
    </div>
    <div className="px-1 pb-2.5 pt-1.5"><CategoryTabs active="商务" size="sm" /></div>
    <div className="grid grid-cols-3 gap-x-3 gap-y-3.5 max-h-[318px] overflow-hidden px-1 mask-fade-bottom">
      {items.map((t, i) => <TemplateCard key={t.id} tpl={t} compact hovered={i === 1} />)}
    </div>
    <div className="mt-3 flex items-center gap-2 border-t border-border/50 px-1 pt-2.5">
      <span className="text-xs text-muted-foreground">选一个模板即可开始，主题色、品牌、画幅可在之后的「⋯」里改</span>
      <Button variant="ghost" className="ml-auto h-7 px-2.5 text-xs rounded-[6px]">查看全部模板</Button>
    </div>
  </div>
}

function ChatScreen() {
  const ready = useMockSessions('chat')
  const slots: MockSlots = { afterAttachBadge: <div className="relative"><PptButtonBadge open /><AnchoredGallery /></div> }
  const item = React.useMemo(() => [
    { id: 'chat-1', name: 'Q3 华东区销售复盘', t: 60_000 }, { id: 's2', name: '合同条款对比', t: 3_600_000 }, { id: 's3', name: '周报润色', t: 7_200_000 },
    { id: 's4', name: '竞品定价调研', t: 86_400_000 }, { id: 's5', name: '招聘 JD 起草', t: 2 * 86_400_000 }, { id: 's6', name: 'Python 脚本排错', t: 3 * 86_400_000 },
  ].map(s => extractSessionMeta({ id: s.id, name: s.name, workspaceId: 'playground-workspace', workspaceName: 'Playground', workMode: 'NORM', messages: [], lastMessageAt: Date.now() - s.t, isProcessing: false } as any)), [])
  return <ChatProviders sessionId="chat-1" slots={slots}>
    <Shell topBarExtra={<BoardListToggle value="NORM" onChange={() => {}} />}
      sidebar={<Sidebar active="chat" />}
      navigator={<div className="h-full flex flex-col"><PanelHeader title="普通会话" titleAlign="start" actions={<HeaderIconButton icon={<Search className="h-4 w-4" />} tooltip="搜索" />} />
        <div className="flex-1 overflow-hidden pt-1">{item.map((m, i) => <SessionItem key={m.id} item={m} index={i} itemProps={{ onKeyDown: () => {} } as any} isSelected={i === 0} isFirstInGroup={i === 0} isInMultiSelect={false} onSelect={() => {}} />)}</div></div>}
      content={ready ? <ChatPage sessionId="chat-1" /> : null} />
  </ChatProviders>
}

function ProChatScreen({ kind }: { kind: 'generating' | 'edit' }) {
  const ready = useMockSessions(kind)
  return <ChatProviders sessionId="ppt-1" draft={kind === 'edit' ? '把这两个标题改得更口语化' : ''} slots={{ afterAttachBadge: <PptSkillBadge /> }} office>
    <Shell immersive content={ready ? <ChatPage sessionId="ppt-1" /> : null} office={<OfficeAside mode={kind} />} />
  </ChatProviders>
}

export function MockupApp() {
  React.useEffect(() => {
    if (IS_PRO_VIEW) document.documentElement.dataset.workMode = 'PRO'
    else delete document.documentElement.dataset.workMode
  }, [])
  if (SCREEN === 'chat') return <ChatScreen />
  if (SCREEN === 'generating' || SCREEN === 'edit') return <ProChatScreen kind={SCREEN} />
  if (SCREEN === 'anim') return <ChatProviders sessionId="ppt-new"><AnimScreen /></ChatProviders>
  const home = SCREEN === 'home' || SCREEN === 'empty'
  return <ChatProviders sessionId="ppt-new">
    <Shell sidebar={<Sidebar active="ppt" />} navigator={<PptNavigator empty={SCREEN === 'empty'} />}
      content={<PptHome order={home ? undefined : ANIM_ORDER} hovered={home ? 'ppt169_raft_consensus_deepdive' : undefined} selected={home ? undefined : SELECTED_TPL} menuOpen={!home} withFile={!home} text={home ? undefined : USER_TEXT} />} />
  </ChatProviders>
}


// ---------------------------------------------------------------- Selection animation (deterministic timeline, driven by window.__setAnimT)
const easeInOut = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const backOut = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) }

function AnimScreen() {
  const [t, setT] = React.useState(0)
  const [geo, setGeo] = React.useState<{ src: DOMRect; slot: DOMRect; start: { x: number; y: number } } | null>(null)
  const measure = React.useCallback(() => {
    const src = document.querySelector(`[data-tpl-card="${SELECTED_TPL}"]`)?.getBoundingClientRect()
    const slot = document.querySelector('[data-tilt-slot]')?.getBoundingClientRect()
    const editor = document.querySelector('[data-tutorial="chat-input"]')?.getBoundingClientRect()
    if (src && slot && editor && src.width > 0) { setGeo({ src, slot, start: { x: editor.right - 160, y: editor.top + 40 } }); return true }
    return false
  }, [])
  React.useEffect(() => {
    (window as any).__setAnimT = (v: number) => { if (v === 0) measure(); setT(v) }
    const id = setInterval(() => { if (measure()) { (window as any).__animReady = true; clearInterval(id) } }, 100)
    return () => clearInterval(id)
  }, [measure])
  // timeline (s)
  const T_HOVER = 0.45, T_PRESS = 0.8, T_FLY = 0.92, FLY = 0.5, T_LAND = T_FLY + FLY, T_HOVER2 = 2.75
  const flyP = spring(t - T_FLY)
  const landed = t >= T_LAND
  const settle = landed ? clamp01((t - T_LAND) / (DSH.durationMs / 1000)) : 0
  const spreadP = backOut(seg(t, T_LAND + 0.05, T_LAND + 0.35))
  const hover = dshEase(seg(t, T_HOVER2, T_HOVER2 + 0.2))
  const fullSlot = ATTACH_CARD.width + ATTACH_CARD.pad.left + attachTrail()
  const slotWidth = t < T_FLY ? 0 : fullSlot * clamp01(flyP)
  let cursor = { x: 0, y: 0 }, clone: React.ReactNode = null
  if (geo) {
    const W = ATTACH_CARD.width
    const target = { x: geo.slot.left + ATTACH_CARD.pad.left + W / 2, y: geo.slot.bottom - ATTACH_CARD.pad.bottom - W * 9 / 32 }
    const srcC = { x: geo.src.left + geo.src.width / 2, y: geo.src.top + geo.src.height / 2 }
    const m1 = easeInOut(seg(t, 0, 0.7)), m2 = easeInOut(seg(t, 2.2, 2.75))
    const p1 = { x: lerp(geo.start.x, srcC.x + 18, m1), y: lerp(geo.start.y, srcC.y + 10, m1) }
    cursor = { x: lerp(p1.x, target.x + 14, m2), y: lerp(p1.y, target.y + 8, m2) }
    if (t >= T_FLY && !landed) {
      const p = flyP
      const w = lerp(geo.src.width, W * DSH.entryScale, p)
      const cx = lerp(srcC.x, target.x, p), cy = lerp(srcC.y, target.y, p) - 46 * Math.sin(Math.PI * clamp01(p))
      const lift = Math.sin(Math.PI * clamp01(p))
      clone = createPortal(<div className="pointer-events-none fixed z-[150] overflow-hidden bg-background" style={{
        left: cx - w / 2, top: cy - w * 9 / 32, width: w, height: w * 9 / 16, transform: `rotate(${DSH.restRotate * p}deg)`,
        borderRadius: lerp(8, DSH.radius, p), border: `${2 * clamp01(p * 2)}px solid var(--accent)`,
        boxShadow: `0 ${4 + 14 * lift}px ${14 + 26 * lift}px rgba(0,0,0,${0.18 + 0.08 * lift})` }}>
        <img src={byId(SELECTED_TPL).thumb} className="h-full w-full object-cover" />
      </div>, document.body)
    }
  }
  const tilt: TiltProps = { collapse: t < T_FLY ? 0 : clamp01(flyP), slotWidth: t < T_FLY ? 0 : slotWidth, opacity: landed ? 1 : 0, settle, spread: spreadP, hover }
  return <>
    <Shell sidebar={<Sidebar active="ppt" />} navigator={<PptNavigator />}
      content={<PptHome order={ANIM_ORDER} composerTpl={SELECTED_TPL} selected={t >= T_FLY ? SELECTED_TPL : undefined}
        hovered={t >= T_HOVER && t < T_FLY ? SELECTED_TPL : undefined} pressed={t >= T_PRESS && t < T_FLY ? SELECTED_TPL : undefined}
        withFile text={USER_TEXT} tilt={tilt} />} />
    {clone}
    {geo && <FakeCursor x={cursor.x} y={cursor.y} pressed={t >= T_PRESS && t < T_FLY + 0.06} />}
  </>
}
