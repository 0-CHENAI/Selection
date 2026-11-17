import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip } from 'lucide-react'
import {
  createFileDragDepth,
  droppedFilesFromDataTransfer,
  hasFileDragType,
  shouldResetFileDragOnLeave,
} from '@/lib/external-file-drag'

export const COMPOSER_FILE_DROP_ATTR = 'data-composer-file-drop'

type ComposerFileDropSink = (files: File[]) => void

interface ComposerFileDropContextValue {
  register: (handler: ComposerFileDropSink) => () => void
}

const ComposerFileDropContext = React.createContext<ComposerFileDropContextValue | null>(null)

/** Register the live composer ingest path so pane drops reuse it. */
export function useComposerFileDropSink(handler: ComposerFileDropSink): void {
  const ctx = React.useContext(ComposerFileDropContext)
  const handlerRef = React.useRef(handler)
  handlerRef.current = handler
  React.useEffect(() => {
    if (!ctx) return
    return ctx.register(files => handlerRef.current(files))
  }, [ctx])
}

export function ChatPaneDropOverlay({ hint }: { hint: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="chat-pane-file-drop-overlay"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
    >
      <div className="absolute inset-3 rounded-[16px] border-2 border-dashed border-foreground/20 bg-foreground/[0.04]" />
      <div className="relative flex items-center gap-2 rounded-full bg-background/95 px-3 py-1.5 text-[13px] text-foreground/80 shadow-minimal">
        <Paperclip className="size-3.5" aria-hidden="true" />
        {hint}
      </div>
    </div>
  )
}

/**
 * Whole chat/content pane drop target. Overlay is visual-only; composer keeps
 * its own drop zone and still runs the same ingest path.
 */
export function ChatPaneFileDrop({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const depthRef = React.useRef(createFileDragDepth())
  const sinkRef = React.useRef<ComposerFileDropSink | null>(null)
  const [active, setActive] = React.useState(false)
  const [hasSink, setHasSink] = React.useState(false)

  const context = React.useMemo<ComposerFileDropContextValue>(() => ({
    register(handler) {
      sinkRef.current = handler
      setHasSink(true)
      return () => {
        if (sinkRef.current === handler) {
          sinkRef.current = null
          setHasSink(false)
        }
      }
    },
  }), [])

  const clear = React.useCallback(() => {
    depthRef.current.reset()
    setActive(false)
  }, [])

  React.useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      clear()
    }
    const onDragEnd = () => clear()
    const onBlur = () => clear()
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('blur', onBlur)
    }
  }, [active, clear])

  const handleDragEnterCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasSink || !hasFileDragType(event.dataTransfer.types)) return
    event.preventDefault()
    if (depthRef.current.enter(event.dataTransfer.types)) setActive(true)
  }

  const handleDragLeaveCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (!active && depthRef.current.depth === 0) return
    event.preventDefault()
    const stillInside = depthRef.current.leave()
    const root = rootRef.current?.getBoundingClientRect()
    if (root && shouldResetFileDragOnLeave(event, root)) {
      clear()
      return
    }
    setActive(stillInside)
  }

  const handleDragOverCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasSink || !hasFileDragType(event.dataTransfer.types)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDropCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDragType(event.dataTransfer.types)) return
    event.preventDefault()
    clear()
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasSink || !hasFileDragType(event.dataTransfer.types)) return
    // Composer keeps its own drop handlers; don't ingest twice.
    if (event.target instanceof Element && event.target.closest(`[${COMPOSER_FILE_DROP_ATTR}]`)) return
    event.preventDefault()
    event.stopPropagation()
    const files = droppedFilesFromDataTransfer(event.dataTransfer)
    if (files.length === 0) return
    sinkRef.current?.(files)
  }

  return (
    <ComposerFileDropContext.Provider value={context}>
      <div
        ref={rootRef}
        data-testid="chat-pane-file-drop"
        className="relative flex h-full min-h-0 min-w-0 flex-col"
        onDragEnterCapture={handleDragEnterCapture}
        onDragLeaveCapture={handleDragLeaveCapture}
        onDragOverCapture={handleDragOverCapture}
        onDropCapture={handleDropCapture}
        onDrop={handleDrop}
      >
        {children}
        {active && hasSink && <ChatPaneDropOverlay hint={t('chat.dropToAttach')} />}
      </div>
    </ComposerFileDropContext.Provider>
  )
}
