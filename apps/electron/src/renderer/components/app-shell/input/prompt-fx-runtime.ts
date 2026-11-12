/** Decorative composer canvases (sparks + Max WebGL). Pause only when truly invisible. */

/** Original Max/sparks backing-store cap: `Math.min(devicePixelRatio, 2)`. */
export const PROMPT_FX_DPR_CAP = 2

export function decorativeLayerDpr(devicePixelRatio = 1, cap = PROMPT_FX_DPR_CAP): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1
  return Math.min(devicePixelRatio, cap)
}

export function promptFxPageVisible(doc: { visibilityState?: string; hidden?: boolean } | null | undefined): boolean {
  if (!doc) return true
  if (typeof doc.visibilityState === 'string') return doc.visibilityState === 'visible'
  return !doc.hidden
}

export type PromptFxCssBox = { width: number; height: number }

export function promptFxBoxFromObserver(entry: {
  contentBoxSize?: ReadonlyArray<{ inlineSize: number; blockSize: number }> | { inlineSize: number; blockSize: number }
  contentRect?: { width: number; height: number }
}): PromptFxCssBox {
  const sizes = entry.contentBoxSize
  const box = Array.isArray(sizes) ? sizes[0] : sizes
  if (box && Number.isFinite(box.inlineSize) && Number.isFinite(box.blockSize)) {
    return { width: box.inlineSize, height: box.blockSize }
  }
  return { width: entry.contentRect?.width ?? 0, height: entry.contentRect?.height ?? 0 }
}

/**
 * CSS pixel size without a layout walk of ancestors. `clientWidth` is the
 * content box; `getBoundingClientRect` is only a cold-start fallback (tests,
 * first layout) and must stay off the rAF path.
 */
export function promptFxReadCssBox(canvas: {
  clientWidth?: number
  clientHeight?: number
  getBoundingClientRect?: () => { width: number; height: number }
}): PromptFxCssBox {
  const width = canvas.clientWidth ?? 0
  const height = canvas.clientHeight ?? 0
  if (width > 0 && height > 0) return { width, height }
  try {
    const rect = canvas.getBoundingClientRect?.()
    if (rect) return { width: rect.width, height: rect.height }
  } catch { /* jsdom */ }
  return { width, height }
}

export function promptFxCanvasDisplayed(input: {
  width: number
  height: number
  isConnected?: boolean
  display?: string
  visibility?: string
}): boolean {
  if (input.isConnected === false) return false
  if (input.display === 'none' || input.visibility === 'hidden') return false
  return input.width > 1 && input.height > 1
}

export type PromptFxGate = {
  reducedMotion: boolean
  visible: boolean
  intersecting: boolean
  displayed: boolean
}

/**
 * Animate whenever the user could see the canvas. Hidden / minimized /
 * occluded documents, offscreen canvases, `display:none`, and unmount drop
 * the rAF chain. A visible idle field stays at full frame rate and DPR.
 */
export function promptFxShouldLoop(gate: PromptFxGate): boolean {
  if (gate.reducedMotion) return false
  return gate.visible && gate.intersecting && gate.displayed
}

export type PromptFxClock = {
  offset: number
  pausedAt: number | null
}

export function createPromptFxClock(): PromptFxClock {
  return { offset: 0, pausedAt: null }
}

/** Freeze the animation clock while paused so resume has no visible jump. */
export function promptFxSyncClock(clock: PromptFxClock, looping: boolean, wallNow: number): number {
  if (!looping) {
    if (clock.pausedAt == null) clock.pausedAt = wallNow
    return clock.pausedAt - clock.offset
  }
  if (clock.pausedAt != null) {
    clock.offset += wallNow - clock.pausedAt
    clock.pausedAt = null
  }
  return wallNow - clock.offset
}

function listen(target: unknown, type: string, listener: EventListener): () => void {
  const host = target as { addEventListener?: (type: string, listener: EventListener) => void; removeEventListener?: (type: string, listener: EventListener) => void } | null | undefined
  if (!host || typeof host.addEventListener !== 'function') return () => {}
  host.addEventListener(type, listener)
  return () => {
    if (typeof host.removeEventListener === 'function') host.removeEventListener(type, listener)
  }
}

function readComputedDisplay(canvas: HTMLCanvasElement): { display?: string; visibility?: string } {
  try {
    const style = getComputedStyle(canvas)
    return { display: style.display, visibility: style.visibility }
  } catch {
    return {}
  }
}

export type PromptFxGateState = {
  visible: boolean
  intersecting: boolean
  displayed: boolean
  box: PromptFxCssBox
}

/**
 * Page visibility, intersection, and cached layout. Callers own the animation
 * clock so a paused canvas keeps its last frame and time origin.
 */
export function attachPromptFxGate(
  canvas: HTMLCanvasElement,
  onChange: () => void,
  onBox?: (box: PromptFxCssBox) => void,
): { state: PromptFxGateState; dispose: () => void } {
  const box = promptFxReadCssBox(canvas)
  const style = readComputedDisplay(canvas)
  const state: PromptFxGateState = {
    visible: promptFxPageVisible(document),
    intersecting: true,
    displayed: promptFxCanvasDisplayed({
      ...box,
      isConnected: canvas.isConnected,
      display: style.display,
      visibility: style.visibility,
    }),
    box,
  }

  const emitBox = (next: PromptFxCssBox, force = false) => {
    const styleNow = readComputedDisplay(canvas)
    const displayed = promptFxCanvasDisplayed({
      ...next,
      isConnected: canvas.isConnected,
      display: styleNow.display,
      visibility: styleNow.visibility,
    })
    const boxChanged = state.box.width !== next.width || state.box.height !== next.height
    if (!force && !boxChanged && state.displayed === displayed) return
    state.box = next
    state.displayed = displayed
    onBox?.(next)
    onChange()
  }

  const unvis = listen(document, 'visibilitychange', () => {
    const visible = promptFxPageVisible(document)
    if (state.visible === visible) return
    state.visible = visible
    onChange()
  })
  // DPR / window size can change without a content-box resize.
  const unresize = listen(window, 'resize', () => emitBox(state.box, true))

  let intersection: IntersectionObserver | undefined
  if (typeof IntersectionObserver === 'function') {
    intersection = new IntersectionObserver(entries => {
      const last = entries[entries.length - 1]
      const intersecting = last ? last.isIntersecting : state.intersecting
      if (state.intersecting === intersecting) return
      state.intersecting = intersecting
      onChange()
    }, { threshold: 0 })
    intersection.observe(canvas)
  }

  let resize: ResizeObserver | undefined
  if (typeof ResizeObserver === 'function') {
    resize = new ResizeObserver(entries => {
      const last = entries[entries.length - 1]
      if (!last) return
      emitBox(promptFxBoxFromObserver(last))
    })
    resize.observe(canvas)
  }

  onBox?.(state.box)

  return {
    state,
    dispose() {
      unvis()
      unresize()
      intersection?.disconnect()
      resize?.disconnect()
    },
  }
}
