export const SEMANTIC_REVEAL_MS = 180
export const SEMANTIC_REVEAL_MAX_MS = 1600
export const SEMANTIC_REVEAL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const MAX_UNITS_PER_FRAME = 32

export function semanticRevealFrames(blur = '0px') {
  if (parseFloat(blur) === 0) return [{ opacity: 0 }, { opacity: 1 }]
  return [{ opacity: 0, filter: `blur(${blur})` }, { opacity: 1, filter: 'blur(0px)' }]
}

export function semanticRevealTiming(duration = SEMANTIC_REVEAL_MS, easing = SEMANTIC_REVEAL_EASING) {
  return {
    duration,
    // Arrival cadence comes from the server, never a word-by-word replay queue.
    delay: 0,
    easing,
    fill: 'backwards' as FillMode,
  }
}

export function getRevealUnits(root: HTMLElement): HTMLElement[] {
  const selector = '[data-stream-chunk],p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,[data-ca-block-type]'
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(element => {
    if (element.hasAttribute?.('data-stream-chunk')) return true
    if (element.querySelector?.('[data-stream-chunk]')) return false
    const parent = element.parentElement?.closest(selector)
    return !parent || !root.contains(parent)
  })
}

/** Reveal only appended visual lines. Width changes and edits are not append. */
export function appendedRevealInset(previousHeight: number, height: number): number {
  return height > previousHeight + 1 ? Math.max(0, 100 * (height - previousHeight) / height) : 0
}

/** A live card far below or above the reader must not be measured on every token. */
export function revealRootOffscreen(root: HTMLElement, top: number, bottom: number): boolean {
  if (typeof root.getBoundingClientRect !== 'function') return false
  const rect = root.getBoundingClientRect()
  const slack = 600
  return rect.bottom < top - slack || rect.top > bottom + slack
}

function scrollViewport(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return null
}

type UnitState = {
  text: string
  height: number
  width: number
  pending: boolean
  clip: string
}

/** Owns visual effects only. Source, DOM identity and document layout stay intact. */
export function createSemanticReveal(root: HTMLElement, animateInitial: boolean) {
  // Read shared motion tokens once per admitted message, not on each delta.
  const style = getComputedStyle(root)
  const fade = style.getPropertyValue('--stream-fade').trim()
  const parsedDuration = parseFloat(fade) * (fade.endsWith('ms') ? 1 : 1000)
  const duration = Number.isFinite(parsedDuration) ? Math.max(0, parsedDuration) : SEMANTIC_REVEAL_MS
  const blur = style.getPropertyValue('--stream-blur').trim() || '0px'
  const easing = style.getPropertyValue('--stream-ease').trim() || SEMANTIC_REVEAL_EASING
  const states = new WeakMap<HTMLElement, UnitState>()
  const pending = new Set<HTMLElement>()
  const active = new Map<HTMLElement, Animation>()
  const viewport = scrollViewport(root)
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let initial = true
  let enabled = false
  let streaming = false
  let deadline: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined
  let disposed = false
  let completionExpired = false
  let source: string | undefined

  const expose = (unit: HTMLElement) => {
    active.get(unit)?.cancel()
    active.delete(unit)
    unit.classList.remove('t-stream-w', 'is-in')
    const state = states.get(unit)
    if (state?.pending) {
      unit.style.clipPath = state.clip
      state.pending = false
    }
    pending.delete(unit)
    observer?.unobserve(unit)
  }
  const flush = () => {
    for (const unit of new Set([...pending, ...active.keys()])) expose(unit)
  }
  const selectionIntersects = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return false
    for (let i = 0; i < selection.rangeCount; i++) {
      if (selection.getRangeAt(i).intersectsNode(root)) return true
    }
    return false
  }

  // Offscreen units stay readable. No global scroll/key listeners: typing and
  // reading other panels are unrelated.
  const schedule = () => {
    if (frame == null) frame = requestAnimationFrame(() => { frame = undefined; update(streaming, enabled, source) })
  }
  // Syntax highlighting and previews can finish after React's layout effect.
  // Observe content only, never our own animation/style writes.
  const mutations = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(schedule)
  const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) schedule()
  }, { root: viewport })

  function update(isStreaming: boolean, canAnimate: boolean, content?: string) {
    if (disposed) return
    const frontier = source?.length ?? 0
    const append = source == null || content == null || content.startsWith(source)
    source = content
    if (isStreaming && !streaming) {
      clearTimeout(deadline)
      deadline = undefined
      completionExpired = false
    }
    streaming = isStreaming
    enabled = canAnimate
    if (enabled && !completionExpired) mutations?.observe(root, { subtree: true, childList: true, characterData: true })
    const immediate = !enabled || motion.matches || selectionIntersects() || completionExpired || (initial && !animateInitial)
    if (immediate) {
      // Completion closes admission, not animations already playing.
      // User interaction/reduced motion still exposes everything immediately.
      if (completionExpired && enabled && !motion.matches && !selectionIntersects()) {
        for (const unit of pending) expose(unit)
      } else flush()
    }
    // Restored history has no reveal work. Avoid scanning every paragraph and
    // reading viewport geometry each time a virtual row enters the DOM.
    if (!enabled) {
      // Keep the initial baseline guard: if this cached history later resumes
      // streaming, seed its current paragraphs without fading old text again.
      mutations?.disconnect()
      return
    }
    const bounds = viewport?.getBoundingClientRect()
    const top = Math.max(0, bounds?.top ?? 0)
    const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight)
    // getBoundingClientRect/textContent on descendants forces layout and defeats
    // content-visibility on a streaming row the reader has scrolled away from.
    const offscreen = revealRootOffscreen(root, top, bottom)
    if (offscreen) initial = false
    if (!offscreen) {
      const measurements: Array<{ unit: HTMLElement; state: UnitState; height: number; width: number; inset: number; below: boolean; animate: boolean }> = []
      // Only changed text needs geometry; completed paragraphs never remeasure on
      // ordinary deltas. A burst beyond the budget is shown immediately.
      const changed = getRevealUnits(root).map(unit => ({ unit, text: unit.textContent ?? '', previous: states.get(unit) }))
        .filter(({ text, previous }) => previous?.text !== text || previous.pending)
      // Retain a budget at both ends of a fast burst: autoscroll commonly lands
      // on the tail, which must not lose every animation to offscreen early units.
      const budget = new Set(changed.length <= MAX_UNITS_PER_FRAME ? changed : [
        ...changed.slice(0, MAX_UNITS_PER_FRAME / 2), ...changed.slice(-MAX_UNITS_PER_FRAME / 2),
      ])
      for (const candidate of changed) {
        const { unit, text, previous } = candidate
        const start = unit.getAttribute?.('data-stream-start')
        const end = unit.getAttribute?.('data-stream-end')
        // AST restructuring replaces DOM nodes (e.g. closing ** / a link or a
        // table delimiter). Source ranges, not DOM identity, decide what is new.
        // Unmapped/generated nodes are conservative after the initial commit.
        const newSource = content == null || (append && (frontier === 0 || (
          start != null && end != null && Number(start) >= frontier && Number(end) > frontier
        )))
        if (immediate || !append || (!previous && !newSource) || !budget.has(candidate) || typeof unit.animate !== 'function') {
          expose(unit)
          states.set(unit, { text, height: 0, width: 0, pending: false, clip: unit.style.clipPath })
          continue
        }
        const rect = unit.getBoundingClientRect()
        // A paragraph fades only on admission. Appending tokens or wrapping
        // onto another line must not replay an effect over text being read.
        const inset = previous && !previous.pending ? 0 : 100
        const state = previous ?? { text, height: 0, width: 0, pending: false, clip: unit.style.clipPath }
        state.text = text
        states.set(unit, state)
        measurements.push({ unit, state, height: rect.height, width: rect.width, inset, below: rect.top >= bottom, animate: rect.bottom > top && rect.height > 0 })
      }
      measurements.forEach(({ unit, state, height, width, inset, below, animate }) => {
        state.height = height
        state.width = width
        if (below && inset === 100) {
          // A live tail is often below the viewport. Clipping it fully hid the
          // rest of the reply for the whole stream: the completion deadline does
          // not start while streaming, and a fully clipped box may never
          // intersect. Keep the text readable and skip the offscreen fade.
          expose(unit)
          state.pending = false
          state.clip = ''
          unit.style.clipPath = ''
          return
        }
        if (inset <= 0) return
        expose(unit)
        if (!animate) return
        // Fade new arrivals without wiping/reflowing previously shown text.
        // Blur is opt-in; the default creates no filter animation layers.
        unit.classList.add('t-stream-w', 'is-in')
        const animation = unit.animate(semanticRevealFrames(blur), semanticRevealTiming(duration, easing))
        active.set(unit, animation)
        animation.onfinish = () => {
          if (active.get(unit) !== animation) return
          active.delete(unit)
          // Do not leave filter layers attached to completed/history text.
          unit.classList.remove('t-stream-w', 'is-in')
        }
      })
    }
    initial = false
    // The deadline starts once, not again for each delta/IntersectionObserver.
    if (enabled && !streaming && deadline == null) {
      deadline = setTimeout(() => {
        completionExpired = true
        // A late-entering tail may have just started fading. Only release
        // offscreen pending content; active animations finish on their own.
        for (const unit of pending) expose(unit)
        mutations?.disconnect()
      }, SEMANTIC_REVEAL_MAX_MS)
    }
    for (const unit of new Set([...pending, ...active.keys()])) {
      if (!root.contains(unit)) expose(unit)
    }
  }

  const selectionChanged = () => { if (selectionIntersects()) flush() }
  const motionChanged = () => { if (motion.matches) flush() }
  root.addEventListener('pointerdown', flush)
  root.addEventListener('focusin', flush)
  document.addEventListener('selectionchange', selectionChanged)
  motion.addEventListener('change', motionChanged)
  // Reflow from window resizing must not reveal old lines a second time.
  window.addEventListener('resize', flush)
  return {
    update,
    dispose() {
      disposed = true
      clearTimeout(deadline)
      if (frame != null) cancelAnimationFrame(frame)
      flush()
      observer?.disconnect()
      mutations?.disconnect()
      root.removeEventListener('pointerdown', flush)
      root.removeEventListener('focusin', flush)
      document.removeEventListener('selectionchange', selectionChanged)
      motion.removeEventListener('change', motionChanged)
      window.removeEventListener('resize', flush)
    },
  }
}
