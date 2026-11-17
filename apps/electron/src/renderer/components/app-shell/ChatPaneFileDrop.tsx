import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  createFileDragDepth,
  droppedFilesFromDataTransfer,
  hasFileDragType,
  shouldResetFileDragOnLeave,
} from '@/lib/external-file-drag'

export const COMPOSER_FILE_DROP_ATTR = 'data-composer-file-drop'

const OVERLAY_EASE = [0.4, 0, 0.2, 1] as const
const OVERLAY_CLASS = 'pointer-events-none absolute inset-0 z-30 isolate flex flex-col items-center justify-center bg-background/40 backdrop-blur-[16px] [-webkit-backdrop-filter:blur(16px)]'

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

function DropHint({ hint }: { hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 text-foreground/80">
      <FileUp className="size-7" strokeWidth={1.5} aria-hidden="true" />
      <p className="text-[13px] font-medium">{hint}</p>
    </div>
  )
}

/** Frosted pane overlay: blur + centered file icon and hint. */
export function ChatPaneDropOverlay({ hint }: { hint: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="chat-pane-file-drop-overlay"
      className={OVERLAY_CLASS}
    >
      <DropHint hint={hint} />
    </div>
  )
}

/**
 * Whole chat/content pane drop target. Overlay is visual-only; composer keeps
 * its own drop zone and still runs the same ingest path.
 */
export function ChatPaneFileDrop({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const depthRef = React.useRef(createFileDragDepth())
  const sinkRef = React.useRef<ComposerFileDropSink | null>(null)
  const [active, setActive] = React.useState(false)
  const [hasSink, setHasSink] = React.useState(false)
  const fade = reduceMotion
    ? { duration: 0 }
    : { duration: 0.25, ease: OVERLAY_EASE }

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

  const hint = t('chat.dropToAttach')

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
        <AnimatePresence>
          {active && hasSink && (
            <motion.div
              key="pane-file-drop-overlay"
              role="status"
              aria-live="polite"
              data-testid="chat-pane-file-drop-overlay"
              className={OVERLAY_CLASS}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
            >
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: 4 }}
                transition={fade}
              >
                <DropHint hint={hint} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ComposerFileDropContext.Provider>
  )
}
