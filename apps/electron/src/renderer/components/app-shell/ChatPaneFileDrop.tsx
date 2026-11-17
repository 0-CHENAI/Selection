import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react'
import { Folder } from '@/components/ui/folder-component'
import {
  createFileDragDepth,
  droppedFilesFromDataTransfer,
  hasFileDragType,
  shouldResetFileDragOnLeave,
} from '@/lib/external-file-drag'
import {
  PANE_DROP_WASH,
  createPaneDropPlayer,
} from '@/components/app-shell/pane-drop-overlay-motion'

export const COMPOSER_FILE_DROP_ATTR = 'data-composer-file-drop'

const OVERLAY_POSITION_CLASS = 'pointer-events-none absolute inset-0 z-30 isolate flex flex-col items-center justify-center'
const OVERLAY_CLASS = `${OVERLAY_POSITION_CLASS} bg-background/40 backdrop-blur-[16px] [-webkit-backdrop-filter:blur(16px)]`

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

type FolderThemeColor = 'black' | 'white'

function folderColorFromDocument(): FolderThemeColor {
  if (typeof document === 'undefined') return 'black'
  return document.documentElement.classList.contains('dark') ? 'white' : 'black'
}

/** Follow the live `dark` class so the overlay Folder switches with the app theme. */
function useFolderThemeColor(): FolderThemeColor {
  const [color, setColor] = React.useState<FolderThemeColor>(folderColorFromDocument)
  React.useEffect(() => {
    const root = document.documentElement
    const sync = () => setColor(folderColorFromDocument())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return color
}

function DropHint({
  hint,
  color,
  folderHovered,
  folderOpen,
}: {
  hint: string
  color: FolderThemeColor
  folderHovered: boolean
  folderOpen: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-foreground/80">
      <Folder
        color={color}
        size="sm"
        hovered={folderHovered}
        open={folderOpen}
        className="h-auto w-auto shrink-0"
        data-folder-color={color}
        aria-hidden="true"
      />
      <p className="text-[13px] font-medium">{hint}</p>
    </div>
  )
}

/** Frosted pane overlay: blur + centered Rare UI folder and hint. */
export function ChatPaneDropOverlay({
  hint,
  color = 'black',
}: {
  hint: string
  color?: FolderThemeColor
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="chat-pane-file-drop-overlay"
      className={OVERLAY_CLASS}
    >
      <DropHint hint={hint} color={color} folderHovered folderOpen={false} />
    </div>
  )
}

type OverlayPhase = 'idle' | 'over' | 'leaving' | 'accepting'

/**
 * Whole chat/content pane drop target. Overlay is visual-only; composer keeps
 * its own drop zone and still runs the same ingest path.
 */
export function ChatPaneFileDrop({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const reduceMotionRef = React.useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const rootRef = React.useRef<HTMLDivElement>(null)
  const depthRef = React.useRef(createFileDragDepth())
  const sinkRef = React.useRef<ComposerFileDropSink | null>(null)
  const phaseRef = React.useRef<OverlayPhase>('idle')
  const [present, setPresent] = React.useState(false)
  const presentRef = React.useRef(false)
  presentRef.current = present
  const pendingEnterRef = React.useRef(false)
  const [hasSink, setHasSink] = React.useState(false)
  const [folderHovered, setFolderHovered] = React.useState(false)
  const [folderOpen, setFolderOpen] = React.useState(false)

  const blur = useMotionValue(0)
  const wash = useMotionValue(0)
  const hintOpacity = useMotionValue(0)
  const hintY = useMotionValue(10)
  const hintScale = useMotionValue(0.94)
  const acceptHold = useMotionValue(0)
  const washOpacity = useTransform(wash, value => value * PANE_DROP_WASH)
  const backdrop = useTransform(blur, value => `blur(${value}px)`)

  const playerRef = React.useRef<ReturnType<typeof createPaneDropPlayer> | null>(null)
  if (playerRef.current == null) {
    playerRef.current = createPaneDropPlayer(
      { blur, wash, hintOpacity, hintY, hintScale, acceptHold },
      () => Boolean(reduceMotionRef.current),
    )
  }

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

  const playEnter = React.useCallback(() => {
    phaseRef.current = 'over'
    setFolderOpen(false)
    setFolderHovered(true)
    if (presentRef.current) {
      pendingEnterRef.current = false
      playerRef.current?.enter()
      return
    }
    pendingEnterRef.current = true
    setPresent(true)
  }, [])

  React.useLayoutEffect(() => {
    if (!present || !pendingEnterRef.current) return
    pendingEnterRef.current = false
    playerRef.current?.enter()
  }, [present])

  const playLeave = React.useCallback(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'accepting') return
    if (phaseRef.current === 'leaving') return
    phaseRef.current = 'leaving'
    setFolderOpen(false)
    setFolderHovered(false)
    void playerRef.current?.leave().then(() => {
      if (phaseRef.current !== 'leaving') return
      phaseRef.current = 'idle'
      setPresent(false)
    })
  }, [])

  const playAccept = React.useCallback(() => {
    phaseRef.current = 'accepting'
    setFolderHovered(true)
    setFolderOpen(true)
    void playerRef.current?.acceptThenLeave().then(() => {
      if (phaseRef.current !== 'accepting') return
      phaseRef.current = 'idle'
      setPresent(false)
    })
  }, [])

  React.useEffect(() => {
    if (!present) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (phaseRef.current === 'accepting') return
      depthRef.current.reset()
      playLeave()
    }
    const onDragEnd = () => {
      if (phaseRef.current === 'accepting') return
      depthRef.current.reset()
      playLeave()
    }
    const onBlur = () => {
      if (phaseRef.current === 'accepting') return
      depthRef.current.reset()
      playLeave()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('blur', onBlur)
    }
  }, [present, playLeave])

  const handleDragEnterCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasSink || !hasFileDragType(event.dataTransfer.types)) return
    event.preventDefault()
    depthRef.current.enter(event.dataTransfer.types)
    if (phaseRef.current === 'over') return
    playEnter()
  }

  const handleDragLeaveCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (phaseRef.current === 'idle' && depthRef.current.depth === 0) return
    event.preventDefault()
    const stillInside = depthRef.current.leave()
    const root = rootRef.current?.getBoundingClientRect()
    if (root && shouldResetFileDragOnLeave(event, root)) {
      depthRef.current.reset()
      playLeave()
      return
    }
    if (!stillInside) playLeave()
  }

  const handleDragOverCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasSink || !hasFileDragType(event.dataTransfer.types)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDropCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDragType(event.dataTransfer.types)) return
    event.preventDefault()
    depthRef.current.reset()
    playAccept()
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
  const folderColor = useFolderThemeColor()

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
        {present && hasSink && (
          <div
            role="status"
            aria-live="polite"
            data-testid="chat-pane-file-drop-overlay"
            className={OVERLAY_POSITION_CLASS}
          >
            <motion.div
              data-pane-drop-frost=""
              className="absolute inset-0"
              style={{
                backdropFilter: backdrop,
                WebkitBackdropFilter: backdrop,
              }}
            />
            <motion.div
              data-pane-drop-wash=""
              className="absolute inset-0 bg-background"
              style={{ opacity: washOpacity }}
            />
            <motion.div
              data-pane-drop-hint=""
              className="relative will-change-[opacity,transform]"
              style={{
                opacity: hintOpacity,
                y: hintY,
                scale: hintScale,
              }}
            >
              <DropHint
                hint={hint}
                color={folderColor}
                folderHovered={folderHovered}
                folderOpen={folderOpen}
              />
            </motion.div>
          </div>
        )}
      </div>
    </ComposerFileDropContext.Provider>
  )
}
