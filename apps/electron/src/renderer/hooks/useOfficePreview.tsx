import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { OFFICE_PREVIEW_MAX_OPEN, OFFICE_PREVIEW_IDLE_TTL_MS, OFFICE_PREVIEW_MAX_SELECTION, type OfficePreviewResult, type OfficeSelection, type SendMessageOptions } from '@craft-agent/shared/protocol'
import { sessionAtomFamily } from '@/atoms/sessions'
import { officePreviewDocument } from '../lib/office-preview-document'
import { OFFICE_PREVIEW_REVEAL, OFFICE_PREVIEW_SHOW_PAGE, pinnedPageAfterScroll, previewDocumentPage, type OfficePreviewPageRequest, type PinnedOfficePage } from '../lib/office-preview-page'
import { officePreviewFileName } from '../lib/office-preview-filename'
import { officePreviewRefreshFailure } from '../lib/office-preview-refresh'
import { decideOfficeSelection } from '../lib/office-selection'
import { officeScrollAnchor, readOfficePreviewState, writeOfficePreviewState, type OfficePreviewScope, type OfficePreviewState } from '../lib/office-preview-state'
import { Popover, PopoverAnchor, PopoverContent } from '../components/ui/popover'
import { ArrowLeftRight, Copy, LoaderCircle, X } from 'lucide-react'
import { FileTypeIcon } from '@craft-agent/ui'
import { toast } from 'sonner'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '../components/ui/alert-dialog'
import { HeaderIconButton } from '../components/ui/HeaderIconButton'
import { OfficePreviewPanel } from '../components/app-shell/OfficePreviewPanel'
import { OfficePreviewFrame } from '../components/app-shell/OfficePreviewFrame'
import { OfficePreviewLoading } from '../components/app-shell/OfficePreviewLoading'
import { OfficeSelectionCapsule } from '../components/app-shell/OfficeSelectionCapsule'
import { RADIUS_EDGE, RADIUS_INNER } from '../components/app-shell/panel-constants'

type PreviewView = OfficePreviewScope & { path: string; pendingDocument?: boolean; pickerInPanel?: boolean; preview?: OfficePreviewResult; document?: string; count: number; candidates?: string[]; error?: string; refreshError?: boolean; requiresRestart?: boolean; busy?: boolean; resuming?: boolean }

const OFFICE_PREVIEW_POLL_MS = 2000
const OFFICE_PREVIEW_LIVE_POLL_MS = 500

type CachedPreview = { view: PreviewView; position: OfficePreviewState; usedAt: number; pending: Promise<unknown> }
const previewKey = (scope: OfficePreviewScope) => JSON.stringify([scope.workspaceId, scope.sessionId])

export function useOfficePreview(activeSessionId: string | null | undefined, workspaceId?: string | null) {
  const { t } = useTranslation()
  const watchedSession = useAtomValue(sessionAtomFamily(activeSessionId || 'office-preview-none'))
  const pptLive = useRef(false)
  pptLive.current = !!activeSessionId && watchedSession?.id === activeSessionId && !!watchedSession.ppt
    && (!!watchedSession.isProcessing || !!watchedSession.pptProgress?.generating)
  const pptPageCount = !!pptLive.current ? (watchedSession?.pptProgress?.pages?.length ?? 0) : 0
  const [view, setView] = useState<PreviewView>()
  const [panelPresent, setPanelPresent] = useState(false)
  const [selectionOverflow, setSelectionOverflow] = useState<{ previewId: string; count: number }>()
  const current = useRef<PreviewView>()
  const cached = useRef(new Map<string, CachedPreview>())
  const [retained, setRetained] = useState<CachedPreview[]>([])
  const scope = useRef<OfficePreviewScope>({ sessionId: activeSessionId ?? '', workspaceId: workspaceId ?? '' })
  const sequence = useRef(0)
  const selectionSequence = useRef(0)
  const selectionTickets = useRef(new Map<string, number>())
  const latestOpen = useRef(new Map<string, number>())
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const scrollY = useRef(0)
  const scrollX = useRef(0)
  const scrollAnchor = useRef<OfficePreviewState['anchor']>()
  const pinnedPage = useRef<PinnedOfficePage | undefined>(undefined)
  const refreshing = useRef<string>()
  const refreshSoon = useRef<(() => void) | undefined>(undefined)
  /** Selection the server already reapplied. Ignore the iframe echo of those paths. */
  const restoreEcho = useRef<{ previewId: string; paths: string[] } | undefined>(undefined)
  const pickerTrigger = useRef<HTMLElement | null>(null)
  const dismissListeners = useRef(new Set<() => void>())
  const composerAnchor = useRef({ getBoundingClientRect: () =>
    (pickerTrigger.current?.isConnected ? pickerTrigger.current.getBoundingClientRect() : undefined)
      ?? document.querySelector('[data-tutorial="chat-input"]')?.getBoundingClientRect()
      ?? new DOMRect(window.innerWidth / 2, window.innerHeight - 100, 0, 0) })
  const releasePreview = useCallback((target: Pick<PreviewView, 'sessionId' | 'preview'>, type: 'suspend' | 'close') => {
    if (!target.preview) return
    void window.electronAPI.officePreview({ type, sessionId: target.sessionId, previewId: target.preview.previewId }).catch(error => {
      if (type === 'suspend' && officePreviewRefreshFailure(error) === 'restart') {
        void window.electronAPI.officePreview({ type: 'close', sessionId: target.sessionId, previewId: target.preview!.previewId }).catch(() => {})
      }
    })
  }, [])
  const syncCached = useCallback(() => {
    const activeKey = current.current && previewKey(current.current)
    const idle = [...cached.current.entries()].filter(([key]) => key !== activeKey).sort((a, b) => a[1].usedAt - b[1].usedAt)
    for (const [key, entry] of idle) {
      if (Date.now() - entry.usedAt < OFFICE_PREVIEW_IDLE_TTL_MS && cached.current.size <= OFFICE_PREVIEW_MAX_OPEN) continue
      cached.current.delete(key)
      selectionTickets.current.delete(entry.view.preview!.previewId)
      latestOpen.current.delete(key)
      releasePreview(entry.view, 'close')
    }
    setRetained([...cached.current.values()])
  }, [releasePreview])
  const updateView = useCallback((update: PreviewView | undefined | ((old: PreviewView | undefined) => PreviewView | undefined)) => {
    const next = typeof update === 'function' ? update(current.current) : update
    if (next === current.current) return
    current.current = next
    setView(next)
    if (next?.preview && next.document) {
      const previous = cached.current.get(previewKey(next))?.view.preview
      if (previous && previous.previewId !== next.preview.previewId) selectionTickets.current.delete(previous.previewId)
      cached.current.set(previewKey(next), { view: next, position: { open: true, path: next.path, scrollY: scrollY.current, scrollX: scrollX.current, anchor: scrollAnchor.current }, usedAt: Date.now(), pending: pending.current })
    }
    syncCached()
  }, [syncCached])
  const updatePreview = useCallback((key: string, previewId: string, update: (old: PreviewView) => PreviewView) => {
    if (current.current && previewKey(current.current) === key && current.current.preview?.previewId === previewId) updateView(update(current.current))
    else {
      const entry = cached.current.get(key)
      if (entry?.view.preview?.previewId === previewId) { entry.view = update(entry.view); syncCached() }
    }
  }, [updateView, syncCached])
  const remember = useCallback(() => {
    const target = current.current
    if (!target?.path) return
    const position = { open: true, path: target.path, scrollY: scrollY.current, scrollX: scrollX.current, anchor: scrollAnchor.current }
    writeOfficePreviewState(target, position)
    const entry = cached.current.get(previewKey(target))
    if (entry) { entry.position = position; entry.usedAt = Date.now(); entry.pending = pending.current }
  }, [])
  // Switching only suspends activity. Explicit close removes the retained page and process.
  const detach = useCallback((type: 'suspend' | 'close' = 'suspend') => {
    sequence.current++
    const old = current.current
    remember()
    if (old && type === 'close') {
      const retained = cached.current.get(previewKey(old))?.view
      if (retained?.preview) { selectionTickets.current.delete(retained.preview.previewId); releasePreview(retained, 'close') }
      cached.current.delete(previewKey(old))
    }
    if (old && type !== 'close') releasePreview(old, type)
    updateView(undefined)
    if (type === 'close') setSelectionOverflow(undefined)
    pending.current = Promise.resolve()
    refreshing.current = undefined
    pickerTrigger.current = null
  }, [remember, releasePreview, updateView])
  const close = useCallback(() => {
    const old = current.current
    detach('close')
    if (old?.path) writeOfficePreviewState(old, { open: false, path: old.path, scrollY: scrollY.current, scrollX: scrollX.current, anchor: scrollAnchor.current })
    else if (old) {
      const saved = readOfficePreviewState(old)
      if (saved) writeOfficePreviewState(old, { ...saved, open: false })
    }
    for (const listener of dismissListeners.current) listener()
  }, [detach])
  const subscribeDismiss = useCallback((listener: () => void) => {
    dismissListeners.current.add(listener)
    return () => { dismissListeners.current.delete(listener) }
  }, [])
  const awaitDocument = useCallback((sessionId: string) => {
    if (sessionId !== scope.current.sessionId || current.current) return
    updateView({ ...scope.current, path: '', pendingDocument: true, busy: true, count: 0, error: undefined })
  }, [updateView])
  const open = useCallback(async (sessionId: string, path = '', candidates?: string[], pickerInPanel = false) => {
    if (sessionId !== scope.current.sessionId) return
    if (pinnedPage.current && pinnedPage.current.path !== path) pinnedPage.current = undefined
    const targetScope = { ...scope.current }, key = previewKey(targetScope)
    const files = [...new Set([...(candidates ?? []), ...(path ? [path] : [])])]
    const saved = readOfficePreviewState(targetScope)
    const existing = cached.current.get(key)
    const reusable = existing?.view.path === path && Date.now() - existing.usedAt < OFFICE_PREVIEW_IDLE_TTL_MS ? existing : undefined
    const keepPosition = current.current && previewKey(current.current) === key && current.current.path === path
    const replaceFile = current.current && previewKey(current.current) === key && path && current.current.path && current.current.path !== path
    detach(replaceFile ? 'close' : 'suspend')
    if (existing && path && existing.view.path !== path) {
      cached.current.delete(key)
      releasePreview(existing.view, 'close')
    }
    pickerTrigger.current = document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-office-collaboration]') ? document.activeElement : null
    if (!keepPosition) {
      const position = reusable?.position ?? (saved?.path === path ? saved : undefined)
      scrollY.current = position?.scrollY ?? 0; scrollX.current = position?.scrollX ?? 0; scrollAnchor.current = position?.anchor
    }
    const position = { open: true, path, scrollY: scrollY.current, scrollX: scrollX.current, anchor: scrollAnchor.current }
    const ticket = sequence.current
    latestOpen.current.set(key, ticket)
    pending.current = reusable?.pending ?? Promise.resolve()
    updateView({ ...reusable?.view, ...targetScope, path, pendingDocument: false, pickerInPanel, candidates: candidates ? files : reusable?.view.candidates ?? files, count: reusable?.view.count ?? 0, busy: !!path, resuming: !!path, error: undefined })
    if (!path) {
      // Choosing is not consent to reopen the previously selected document.
      if (pickerInPanel && saved) writeOfficePreviewState(targetScope, { ...saved, open: false })
      latestOpen.current.delete(key)
      return
    }
    writeOfficePreviewState(targetScope, position)
    if (!candidates && window.electronAPI.getOfficeFiles) void window.electronAPI.getOfficeFiles(sessionId).then(paths => {
      if (ticket === sequence.current) updateView(old => old ? { ...old, candidates: [...new Set([...paths, path])] } : old)
    }).catch(() => {})
    try {
      const preview = await window.electronAPI.officePreview({ type: 'open', sessionId, path, ...(reusable?.view.preview ? { previewId: reusable.view.preview.previewId } : {}) })
      if (!preview) throw new Error('预览未返回内容')
      const same = reusable?.view.preview?.previewId === preview.previewId
      const page = previewDocumentPage(pinnedPage.current, preview.path || path)
      const document = same && page == null ? reusable!.view.document : officePreviewDocument(preview.html ?? '', preview.previewId, { ...position, readOnly: preview.isDraft, ...(page ? { page } : {}) })
      const next: PreviewView = { ...targetScope, path: preview.path, candidates: files, preview: { ...preview, html: undefined }, document,
        count: same ? reusable.view.count : 0 }
      if (ticket !== sequence.current) {
        // A newer open may be reusing this very process. Do not close it out from under that request.
        if (current.current?.preview?.previewId === preview.previewId) return
        const wanted = readOfficePreviewState(targetScope)
        const newer = latestOpen.current.get(key)
        if (newer !== undefined && newer !== ticket && wanted?.open) return
        if (wanted?.open && (wanted.path === path || wanted.path === preview.path)) {
          cached.current.set(key, { view: next, position, usedAt: Date.now(), pending: reusable?.pending ?? Promise.resolve() })
          releasePreview(next, 'suspend'); syncCached()
        } else releasePreview(next, 'close')
        return
      }
      if (!same) pending.current = Promise.resolve()
      writeOfficePreviewState(targetScope, { ...position, path: preview.path })
      updateView({ ...next, candidates: current.current?.candidates ?? files })
    } catch (error) { if (ticket === sequence.current) updateView(old => old ? { ...old, busy: false, resuming: false, error: String(error) } : old) }
    finally { if (latestOpen.current.get(key) === ticket) latestOpen.current.delete(key) }
  }, [detach, releasePreview, syncCached, updateView])
  useEffect(() => {
    const onShow = (event: Event) => {
      const detail = (event as CustomEvent<OfficePreviewPageRequest>).detail
      if (!detail || detail.sessionId !== scope.current.sessionId) return
      if (!Number.isInteger(detail.page) || detail.page < 1 || detail.page > 500 || typeof detail.path !== 'string' || !detail.path) return
      pinnedPage.current = { path: detail.path, page: detail.page }
      const active = current.current
      if (active?.path === detail.path && active.sessionId === detail.sessionId && active.preview) {
        frames.current.get(previewKey(active))?.contentWindow?.postMessage({ type: OFFICE_PREVIEW_SHOW_PAGE, page: detail.page }, '*')
        return
      }
      void open(detail.sessionId, detail.path)
    }
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail
      if (!detail?.sessionId || detail.sessionId !== scope.current.sessionId) return
      awaitDocument(detail.sessionId)
    }
    window.addEventListener(OFFICE_PREVIEW_SHOW_PAGE, onShow)
    window.addEventListener(OFFICE_PREVIEW_REVEAL, onReveal)
    return () => {
      window.removeEventListener(OFFICE_PREVIEW_SHOW_PAGE, onShow)
      window.removeEventListener(OFFICE_PREVIEW_REVEAL, onReveal)
    }
  }, [open, awaitDocument])
  useLayoutEffect(() => {
    detach()
    pinnedPage.current = undefined
    scope.current = { sessionId: activeSessionId ?? '', workspaceId: workspaceId ?? '' }
    const saved = readOfficePreviewState(scope.current)
    if (saved?.open) void open(scope.current.sessionId, saved.path)
  }, [activeSessionId, workspaceId, detach, open])
  useEffect(() => () => detach(), [detach])
  useEffect(() => {
    const timer = setInterval(syncCached, 60_000)
    return () => clearInterval(timer)
  }, [syncCached])
  useEffect(() => window.electronAPI.onReconnected(() => {
    const target = current.current
    if (target?.path) void open(target.sessionId, target.path, target.candidates)
  }), [open])
  useEffect(() => {
    const visibility = () => {
      const target = current.current
      if (!target?.path) return
      if (document.visibilityState === 'hidden') { remember(); releasePreview(target, 'suspend') }
      else void open(target.sessionId, target.path, target.candidates)
    }
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [remember, releasePreview, open])
  useEffect(() => window.electronAPI.onSessionEvent(event => {
    const target = current.current
    if (!target?.requiresRestart || !target.preview || event.type !== 'text_complete' || event.sessionId !== target.sessionId) return
    if (event.artifactVersions?.some(version => version.artifactId === target.preview!.artifactId && version.versionId !== target.preview!.baseVersion)) {
      void open(target.sessionId, target.path, target.candidates)
    }
  }), [open])
  useEffect(() => {
    if (!view?.preview) return
    const previewId = view.preview.previewId, sessionId = view.sessionId
    const key = previewKey({ workspaceId: view.workspaceId, sessionId })
    let disposed = false
    let failures = 0
    let legacyHost = false
    let stopped = false
    let followAgain = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const delay = () => pptLive.current ? OFFICE_PREVIEW_LIVE_POLL_MS : OFFICE_PREVIEW_POLL_MS
    const paintRefresh = (result: OfficePreviewResult, previousId: string) => {
      const paths = result.previewId === previousId ? result.selection?.elements.map(element => element.path) : undefined
      const restorePaths = paths?.length ? paths : undefined
      if (restorePaths) {
        const token = { previewId: result.previewId, paths: restorePaths }
        restoreEcho.current = token
        window.setTimeout(() => { if (restoreEcho.current === token) restoreEcho.current = undefined }, 500)
      }
      else if (restoreEcho.current && (restoreEcho.current.previewId === previousId || restoreEcho.current.previewId === result.previewId)) restoreEcho.current = undefined
      selectionTickets.current.set(result.previewId, ++selectionSequence.current)
      return { restorePaths, count: restorePaths?.length ?? 0 }
    }
    const arm = (wait: number) => {
      clearTimeout(timer)
      timer = setTimeout(run, wait)
    }
    const run = () => {
      if (stopped) return
      if (document.visibilityState === 'hidden' || current.current?.resuming || refreshing.current === previewId) {
        arm(delay())
        return
      }
      refreshing.current = previewId
      void window.electronAPI.officePreview({ type: legacyHost ? 'heartbeat' : 'refresh', sessionId, previewId }).then(result => {
        failures = 0
        if (!result?.html) {
          if (!disposed) updateView(old => old?.preview?.previewId === previewId && old.refreshError ? { ...old, refreshError: false } : old)
          return
        }
        if (disposed || current.current?.preview?.previewId !== previewId) {
          if (current.current?.preview?.previewId === result.previewId) return
          const entry = cached.current.get(key)
          if (entry?.view.preview?.previewId === previewId) {
            if (result.previewId !== previewId) selectionTickets.current.delete(previewId)
            const painted = paintRefresh(result, previewId)
            const cachedPage = previewDocumentPage(pinnedPage.current, entry.view.path)
            entry.view = { ...entry.view, preview: { ...result, html: undefined }, document: officePreviewDocument(result.html, result.previewId, { ...entry.position, readOnly: result.isDraft, restorePaths: painted.restorePaths, ...(cachedPage ? { page: cachedPage } : {}) }), count: painted.count, busy: false }
            entry.pending = Promise.resolve()
            releasePreview(entry.view, 'suspend'); syncCached()
          } else releasePreview({ sessionId, preview: result }, 'close')
          return
        }
        const painted = paintRefresh(result, previewId)
        const livePage = previewDocumentPage(pinnedPage.current, current.current.path)
        const next = { ...current.current, preview: { ...result, html: undefined },
          document: officePreviewDocument(result.html, result.previewId, { scrollY: scrollY.current, scrollX: scrollX.current, anchor: scrollAnchor.current, readOnly: result.isDraft, restorePaths: painted.restorePaths, ...(livePage ? { page: livePage } : {}) }),
          count: painted.count, busy: false, error: undefined, refreshError: false }
        if (result.previewId !== previewId) pending.current = Promise.resolve()
        setSelectionOverflow(undefined)
        updateView(next)
      }).catch(error => {
        if (disposed || current.current?.preview?.previewId !== previewId) return
        const failure = officePreviewRefreshFailure(error)
        if (failure === 'restart') {
          legacyHost = true
          updateView(old => old?.preview?.previewId === previewId ? { ...old, requiresRestart: true, refreshError: false } : old)
          return
        }
        if (failure === 'reopen') {
          const target = current.current
          void open(sessionId, target.path, target.candidates)
          return
        }
        // A candidate may be mid-write. Preserve the last rendered snapshot and retry.
        if (++failures >= 3 && !disposed) updateView(old => old?.preview?.previewId === previewId ? { ...old, refreshError: true } : old)
      }).finally(() => {
        if (refreshing.current === previewId) refreshing.current = undefined
        const wait = followAgain ? 0 : delay()
        followAgain = false
        if (!stopped) arm(wait)
      })
    }
    const kick = () => {
      if (stopped) return
      if (refreshing.current === previewId) { followAgain = true; return }
      arm(0)
    }
    refreshSoon.current = kick
    arm(delay())
    const receive = (event: MessageEvent) => {
      if (event.source === frames.current.get(key)?.contentWindow && event.data?.previewId === previewId && event.data.type === 'selection-office-scroll' && current.current?.preview?.previewId === previewId) {
        if (Number.isFinite(event.data.scrollY)) scrollY.current = Math.max(0, event.data.scrollY)
        if (Number.isFinite(event.data.scrollX)) scrollX.current = Math.max(0, event.data.scrollX)
        scrollAnchor.current = officeScrollAnchor(event.data.anchor)
        pinnedPage.current = pinnedPageAfterScroll(pinnedPage.current, scrollAnchor.current?.path)
        writeOfficePreviewState(current.current, { open: true, path: current.current.path, scrollY: scrollY.current, scrollX: scrollX.current, anchor: scrollAnchor.current })
        return
      }
      if (event.source !== frames.current.get(key)?.contentWindow || event.data?.type !== 'selection-office-selection' || event.data.previewId !== previewId) return
      const decision = decideOfficeSelection({
        paths: event.data.paths,
        previewId,
        isDraft: !!current.current?.preview?.isDraft,
        resuming: !!current.current?.resuming,
        refreshing: refreshing.current === previewId,
        activePreviewId: current.current?.preview?.previewId,
        echo: restoreEcho.current,
      })
      if (decision.type === 'echo') {
        restoreEcho.current = undefined
        return
      }
      if (decision.type === 'ignore') return
      const selectionTicket = ++selectionSequence.current
      selectionTickets.current.set(previewId, selectionTicket)
      // Keep the actual visible count. Never capture the host's previous valid
      // selection after an oversized gesture, or silently truncate its targets.
      if (decision.type === 'overflow') {
        updateView(old => old?.preview?.previewId === previewId ? { ...old, count: decision.count, busy: false, error: undefined } : old)
        setSelectionOverflow({ previewId, count: decision.count })
        return
      }
      setSelectionOverflow(undefined)
      updateView(old => old?.preview?.previewId === previewId ? { ...old, count: decision.count, busy: true, error: undefined } : old)
      // Serialize updates so a slower earlier click cannot overwrite a later selection.
      pending.current = pending.current.catch(() => {}).then(() => window.electronAPI.officePreview({ type: 'select', sessionId, previewId, paths: decision.paths }))
        .then(() => { if (selectionTicket === selectionTickets.current.get(previewId)) updatePreview(key, previewId, old => ({ ...old, busy: false, error: undefined })) })
        .catch(error => { if (selectionTicket === selectionTickets.current.get(previewId)) updatePreview(key, previewId, old => ({ ...old, busy: false, error: String(error) })); throw error })
      const entry = cached.current.get(key)
      if (entry) entry.pending = pending.current
      void pending.current.catch(() => {})
    }
    window.addEventListener('message', receive)
    return () => {
      stopped = true
      disposed = true
      if (refreshSoon.current === kick) refreshSoon.current = undefined
      clearTimeout(timer)
      window.removeEventListener('message', receive)
    }
  }, [view?.preview, view?.sessionId, view?.workspaceId, open, updateView, updatePreview, releasePreview, syncCached])
  useEffect(() => {
    // A new page is already on disk when this count changes. Refresh now;
    // the interval below only covers a missed event.
    if (!pptLive.current) return
    refreshSoon.current?.()
  }, [pptPageCount, activeSessionId, watchedSession?.isProcessing, watchedSession?.pptProgress?.generating])
  const capture = useCallback(async (sessionId: string): Promise<OfficeSelection | undefined> => {
    const target = current.current
    // Opening the panel is context, not a request to edit selected elements.
    // Picker/loading/draft states cannot have an editable selection either.
    if (!target || target.sessionId !== sessionId || !target.preview || !target.count || target.preview.isDraft) return
    if (target.count > OFFICE_PREVIEW_MAX_SELECTION) {
      setSelectionOverflow({ previewId: target.preview.previewId, count: target.count })
      throw new Error(t('chat.officePreview.selectionOverflow', { count: target.count, max: OFFICE_PREVIEW_MAX_SELECTION }))
    }
    if (target.error) throw new Error(target.error)
    if (target.resuming) throw new Error('预览正在恢复，请稍后再提交')
    if (refreshing.current === target.preview.previewId) throw new Error('预览正在刷新，请稍后再提交')
    const capture = pending.current.then(() => window.electronAPI.officePreview({ type: 'capture', sessionId, previewId: target.preview!.previewId }))
    // Later clicks queue after this capture, never ahead of the submitted request.
    pending.current = capture.catch(() => {})
    const result = await capture
    if (current.current?.preview?.previewId !== target.preview.previewId || !result?.selection) throw new Error('预览已切换，请重新提交')
    return result.selection
  }, [t])
  const context = useCallback((sessionId: string): SendMessageOptions['officeContext'] => {
    const target = current.current
    if (target?.sessionId !== sessionId || !target.preview) return
    return { path: target.preview.path }
  }, [])
  const picker = view && !view.path && !view.pickerInPanel && !view.pendingDocument ? <Popover open onOpenChange={isOpen => { if (!isOpen) close() }}>
    <PopoverAnchor virtualRef={composerAnchor} />
    <PopoverContent side="top" align={pickerTrigger.current ? 'end' : 'start'} sideOffset={12}
      className="w-[480px] max-w-[calc(100vw-40px)] bg-background text-foreground opacity-100 shadow-modal-small ring-1 ring-border p-3" aria-label={t('chat.officePreview.choose')}>
      <div className="flex items-center gap-2 px-2 py-2 text-sm">
        <strong className="flex-1">{t('chat.officePreview.choose')}</strong>
        <button type="button" onClick={close}>{t('chat.officePreview.close')}</button>
      </div>
      <p className="px-2 pb-3 text-xs text-foreground/75">{t('chat.officePreview.scope')}</p>
      <div className="max-h-64 overflow-y-auto">
        {!view.candidates?.length && <p className="px-2 py-4 text-sm">{t('chat.officePreview.empty')}</p>}
        {view.candidates?.map(path => <button key={path} type="button" className="block w-full rounded px-3 py-3 text-left text-sm hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" title={path} onClick={() => void open(view.sessionId, path, view.candidates)}>
          <span className="block break-words font-semibold">{path.split(/[/\\]/).pop()}</span>
          <span className="mt-1 block break-all text-xs text-foreground/75">{path}</span>
        </button>)}
      </div>
    </PopoverContent>
  </Popover> : null
  const panels = retained.map(entry => view?.path && previewKey(entry.view) === previewKey(view) ? view : entry.view)
  if (view?.path && !panels.some(target => previewKey(target) === previewKey(view))) panels.push(view)
  const pages = panels.map(target => {
    const key = previewKey(target), active = !!view?.path && previewKey(view) === key
    return <aside key={key} hidden={!active} aria-hidden={!active || undefined}
      style={{ display: active ? undefined : 'none', borderRadius: RADIUS_INNER, borderBottomRightRadius: RADIUS_EDGE }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      aria-label={t('chat.officePreview.title')} className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-foreground-2 shadow-middle">
    <div className="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm">
      <strong className="min-w-0 truncate" title={target.path}>{officePreviewFileName(target.path) || t('chat.officePreview.choose')}</strong>
      <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => void open(target.sessionId, '', target.candidates, true)}>
        <ArrowLeftRight aria-hidden="true" className="size-3.5" />{t('chat.officePreview.switchFile')}
      </button>
      <div className="ml-auto shrink-0"><HeaderIconButton onClick={close} aria-label={t('chat.officePreview.closeLabel')} tooltip={t('chat.officePreview.closeLabel')} icon={<X className="size-4" />} /></div>
    </div>
    {target.error && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{target.error}</p>}
    <div className="relative flex min-h-0 flex-1 flex-col">
      {target.busy && !target.document && !target.error && <OfficePreviewLoading />}
      {target.document && <OfficePreviewFrame ref={element => { if (element) frames.current.set(key, element); else frames.current.delete(key) }} title={t('chat.officePreview.title')} sandbox="allow-scripts" srcDoc={target.document} style={{ pointerEvents: target.resuming ? 'none' : undefined }} aria-busy={target.resuming || undefined} />}
      {target.resuming && target.document && <OfficePreviewLoading compact />}
      {target.preview?.isDraft && !target.resuming && <div role="status" className="pointer-events-none absolute inset-x-3 top-4 z-[3] flex justify-center">
        <div className="flex max-w-full items-center gap-2.5 rounded-full bg-background/95 px-4 py-2.5 text-accent shadow-minimal ring-1 ring-border/50 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200">
          <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
          <div className="min-w-0"><p className="text-xs font-medium">{t('chat.officePreview.draft')}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{t('chat.officePreview.draftHint')}</p></div>
        </div>
      </div>}
      {target.preview && <OfficeSelectionCapsule count={target.count} busy={!!target.busy} />}
    </div>
  </aside>
  })
  const fileChoices = view?.candidates?.map(path => ({ path, name: path.split(/[/\\]/).pop() || path })) ?? []
  const copyFilePath = async (path: string) => {
    try { await navigator.clipboard.writeText(path); toast.success(t('toast.pathCopied')) }
    catch { toast.error(t('toast.copyFailed')) }
  }
  const chooser = view?.pickerInPanel && !view.path ? <aside data-office-file-chooser
    style={{ borderRadius: RADIUS_INNER, borderBottomRightRadius: RADIUS_EDGE }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
    aria-label={t('chat.officePreview.title')} className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-foreground-2 shadow-middle">
    <div className="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm">
      <strong>{t('chat.officePreview.title')}</strong>
      <div className="ml-auto"><HeaderIconButton onClick={close} aria-label={t('chat.officePreview.closeLabel')} tooltip={t('chat.officePreview.closeLabel')} icon={<X className="size-4" />} /></div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <h2 className="mb-4 text-sm font-medium">{t('chat.officePreview.choose')}</h2>
      {!view.candidates?.length && <p className="text-sm text-muted-foreground">{t('chat.officePreview.empty')}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
        {fileChoices.map(({ path, name }) => <li key={path} className="min-w-0">
            <div className="relative grid h-full grid-cols-[2rem_minmax(0,1fr)] gap-x-3 rounded-xl bg-foreground/[0.04] p-4 transition-colors hover:bg-foreground/[0.07] focus-within:bg-foreground/[0.07]">
            <button type="button" data-office-file-card={path} title={path} aria-label={`${t('common.open')} ${name}`}
              onClick={() => void open(view.sessionId, path, view.candidates)}
              className="col-start-2 min-w-0 text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <FileTypeIcon fileName={name} className="absolute left-4 top-1/2 size-8 -translate-y-1/2" />
              <span data-office-file-name className="block break-all text-sm font-medium line-clamp-2">{officePreviewFileName(name.replace(/\.(?:docx|xlsx|pptx)$/i, ''))}</span>
            </button>
            <div className="col-start-2 mt-1 flex min-w-0 items-center gap-1">
              <span data-office-file-path={path} title={path} className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{path}</span>
              <HeaderIconButton data-office-copy-path={path} className="relative z-10"
                aria-label={`${t('common.copyPath')} ${name}`} tooltip={t('common.copyPath')}
                onClick={() => void copyFilePath(path)} icon={<Copy aria-hidden="true" className="size-3.5" />} />
            </div>
            </div>
          </li>)}
      </ul>
    </div>
  </aside> : null
  const pendingDocument = view?.pendingDocument && !view.path ? <aside data-testid="office-preview-pending"
    style={{ borderRadius: RADIUS_INNER, borderBottomRightRadius: RADIUS_EDGE }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
    aria-label={t('chat.officePreview.title')} className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-foreground-2 shadow-middle">
    <div className="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm">
      <strong className="min-w-0 truncate">{t('chat.officePreview.loading')}</strong>
      <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => void open(view.sessionId, '', view.candidates, true)}>
        <ArrowLeftRight aria-hidden="true" className="size-3.5" />{t('chat.officePreview.switchFile')}
      </button>
      <div className="ml-auto shrink-0"><HeaderIconButton onClick={close} aria-label={t('chat.officePreview.closeLabel')} tooltip={t('chat.officePreview.closeLabel')} icon={<X className="size-4" />} /></div>
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col"><OfficePreviewLoading /></div>
  </aside> : null
  const panelOpen = !!view?.path || !!chooser || !!pendingDocument
  const panel = <>
    <OfficePreviewPanel open={panelOpen} onPresenceChange={setPanelPresent}>{chooser}{pendingDocument}{pages}</OfficePreviewPanel>
    <AlertDialog open={!!selectionOverflow && selectionOverflow.previewId === view?.preview?.previewId} onOpenChange={isOpen => { if (!isOpen) setSelectionOverflow(undefined) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('chat.officePreview.selectionOverflowTitle')}</AlertDialogTitle><AlertDialogDescription>{t('chat.officePreview.selectionOverflow', { count: selectionOverflow?.count ?? 0, max: OFFICE_PREVIEW_MAX_SELECTION })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('common.ok')}</AlertDialogCancel></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
  return { open, close, capture, context, panel, picker, awaitDocument, subscribeDismiss, path: view?.path ?? '', pending: !!pendingDocument, isOpen: panelOpen, isPresent: panelOpen || panelPresent, isChoosing: !!view && !view.path && !view.pendingDocument }
}
