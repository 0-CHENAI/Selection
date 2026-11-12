/** Decorative composer canvases (sparks + Max WebGL). Pause work that is not on screen. */

export const PROMPT_FX_DPR_CAP = 1.5
export const PROMPT_FX_AMBIENT_FPS = 30
export const PROMPT_FX_ACTIVE_FPS = 60
export const PROMPT_FX_AMBIENT_FRAME_MS = 1000 / PROMPT_FX_AMBIENT_FPS
export const PROMPT_FX_ACTIVE_FRAME_MS = 1000 / PROMPT_FX_ACTIVE_FPS
export const PROMPT_FX_ENERGY_LIVE = 0.02

export function decorativeLayerDpr(devicePixelRatio = 1, cap = PROMPT_FX_DPR_CAP): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1
  return Math.min(devicePixelRatio, cap)
}

export function promptFxPageVisible(doc: { visibilityState?: string; hidden?: boolean } | null | undefined): boolean {
  if (!doc) return true
  if (typeof doc.visibilityState === 'string') return doc.visibilityState === 'visible'
  return !doc.hidden
}

export function promptFxWindowFocused(doc: { hasFocus?: () => boolean } | null | undefined): boolean {
  try {
    if (doc && typeof doc.hasFocus === 'function') return doc.hasFocus()
  } catch {
    return true
  }
  return true
}

export function promptFxCanvasDisplayed(canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'> & { isConnected?: boolean }): boolean {
  if (typeof canvas.isConnected === 'boolean' && !canvas.isConnected) return false
  const rect = canvas.getBoundingClientRect()
  if (!(rect.width > 1) || !(rect.height > 1)) return false
  try {
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(canvas as HTMLCanvasElement) : undefined
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
  } catch {
    return true
  }
  return true
}

export type PromptFxGate = {
  reducedMotion: boolean
  visible: boolean
  windowFocused: boolean
  intersecting: boolean
  displayed: boolean
  /** Composer is focused or hovered. WebGL fields leave this true while on screen. */
  engaged: boolean
  /** Particles, typing energy, streaming, or a color blend still in flight. */
  live: boolean
}

/**
 * Animate only while the effect can be seen. Hidden, blurred, offscreen, and
 * `display: none` canvases drop the rAF chain; a resting bitmap stays on the canvas.
 */
export function promptFxShouldLoop(gate: PromptFxGate): boolean {
  if (gate.reducedMotion) return false
  if (!gate.visible || !gate.windowFocused || !gate.intersecting || !gate.displayed) return false
  return gate.engaged || gate.live
}

export function promptFxFrameDue(now: number, lastDraw: number, intervalMs: number): boolean {
  if (!(intervalMs > 0) || !(lastDraw > 0)) return true
  return now - lastDraw >= intervalMs - 1
}

export function promptFxFrameIntervalMs(active: boolean): number {
  return active ? PROMPT_FX_ACTIVE_FRAME_MS : PROMPT_FX_AMBIENT_FRAME_MS
}

function listen(target: unknown, type: string, listener: EventListener): () => void {
  const host = target as { addEventListener?: (type: string, listener: EventListener) => void; removeEventListener?: (type: string, listener: EventListener) => void } | null | undefined
  if (!host || typeof host.addEventListener !== 'function') return () => {}
  host.addEventListener(type, listener)
  return () => {
    if (typeof host.removeEventListener === 'function') host.removeEventListener(type, listener)
  }
}

export type PromptFxGateState = {
  visible: boolean
  windowFocused: boolean
  intersecting: boolean
  displayed: boolean
}

/**
 * Visibility, window focus, intersection, and layout. Callers still own the
 * animation clock so a paused canvas can keep its last frame.
 */
export function attachPromptFxGate(
  canvas: HTMLCanvasElement,
  onChange: () => void,
): { state: PromptFxGateState; dispose: () => void } {
  const state: PromptFxGateState = {
    visible: promptFxPageVisible(document),
    windowFocused: promptFxWindowFocused(document),
    intersecting: true,
    displayed: promptFxCanvasDisplayed(canvas),
  }

  const unvis = listen(document, 'visibilitychange', () => {
    const visible = promptFxPageVisible(document)
    if (state.visible === visible) return
    state.visible = visible
    onChange()
  })
  const onFocus = () => {
    if (state.windowFocused) return
    state.windowFocused = true
    onChange()
  }
  const onBlur = () => {
    if (!state.windowFocused) return
    state.windowFocused = false
    onChange()
  }
  const unfocus = listen(window, 'focus', onFocus)
  const unblur = listen(window, 'blur', onBlur)

  let intersection: IntersectionObserver | undefined
  if (typeof IntersectionObserver === 'function') {
    intersection = new IntersectionObserver(entries => {
      const last = entries[entries.length - 1]
      const intersecting = last ? last.isIntersecting : state.intersecting
      if (state.intersecting === intersecting) return
      state.intersecting = intersecting
      onChange()
    })
    intersection.observe(canvas)
  }

  return {
    state,
    dispose() {
      unvis()
      unfocus()
      unblur()
      intersection?.disconnect()
    },
  }
}

export function attachPromptFxEngagement(host: EventTarget | null | undefined, onChange: (engaged: boolean) => void): () => void {
  if (!host || typeof (host as { addEventListener?: unknown }).addEventListener !== 'function') {
    onChange(true)
    return () => {}
  }
  const node = host as Element & { addEventListener: (type: string, listener: EventListener) => void }
  const read = () => {
    try {
      if (typeof node.matches === 'function' && node.matches(':hover, :focus-within')) return true
    } catch { /* jsdom / test hosts */ }
    try {
      if (typeof node.contains === 'function' && document.activeElement && node.contains(document.activeElement)) return true
    } catch { /* tests */ }
    return false
  }
  let engaged = read()
  const emit = () => {
    const next = read()
    if (next === engaged) return
    engaged = next
    onChange(engaged)
  }
  onChange(engaged)
  const unenter = listen(node, 'pointerenter', emit)
  const unleave = listen(node, 'pointerleave', emit)
  const infocus = listen(node, 'focusin', emit)
  const outfocus = listen(node, 'focusout', emit)
  return () => {
    unenter()
    unleave()
    infocus()
    outfocus()
  }
}
