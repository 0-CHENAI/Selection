export const SEMANTIC_REVEAL_MS = 200
export const SEMANTIC_REVEAL_MAX_MS = 300
const MAX_UNITS_PER_FRAME = 32

export function getRevealUnits(root: HTMLElement): HTMLElement[] {
  const selector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,[data-ca-block-type]'
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(element => {
    const parent = element.parentElement?.closest(selector)
    return !parent || !root.contains(parent)
  })
}

/** Reveal only appended visual lines. Width changes and edits are not append. */
export function appendedRevealInset(previousHeight: number, height: number): number {
  return height > previousHeight + 1 ? Math.max(0, 100 * (height - previousHeight) / height) : 0
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

  const expose = (unit: HTMLElement) => {
    active.get(unit)?.cancel()
    active.delete(unit)
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

  // A below-viewport unit remains pending until the scroller brings it into view.
  // No global scroll/key listeners: typing and reading other panels are unrelated.
  const schedule = () => {
    if (frame == null) frame = requestAnimationFrame(() => { frame = undefined; update(streaming, enabled) })
  }
  // Syntax highlighting and previews can finish after React's layout effect.
  // Observe content only, never our own animation/style writes.
  const mutations = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(schedule)
  const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) schedule()
  }, { root: viewport })

  function update(isStreaming: boolean, canAnimate: boolean) {
    if (disposed) return
    if (isStreaming && !streaming) {
      clearTimeout(deadline)
      deadline = undefined
      completionExpired = false
    }
    streaming = isStreaming
    enabled = canAnimate
    if (enabled && !completionExpired) mutations?.observe(root, { subtree: true, childList: true, characterData: true })
    const immediate = !enabled || motion.matches || selectionIntersects() || completionExpired || (initial && !animateInitial)
    if (immediate) flush()
    const bounds = viewport?.getBoundingClientRect()
    const top = Math.max(0, bounds?.top ?? 0)
    const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight)
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
      if (immediate || !budget.has(candidate) || typeof unit.animate !== 'function') {
        expose(unit)
        states.set(unit, { text, height: 0, width: 0, pending: false, clip: unit.style.clipPath })
        continue
      }
      const rect = unit.getBoundingClientRect()
      const append = previous && text.startsWith(previous.text) && Math.abs(rect.width - previous.width) < 1
      const inset = previous && !previous.pending ? (append ? appendedRevealInset(previous.height, rect.height) : 0) : 100
      const state = previous ?? { text, height: 0, width: 0, pending: false, clip: unit.style.clipPath }
      state.text = text
      states.set(unit, state)
      measurements.push({ unit, state, height: rect.height, width: rect.width, inset, below: rect.top >= bottom, animate: rect.bottom > top && rect.height > 0 })
    }
    measurements.forEach(({ unit, state, height, width, inset, below, animate }, index) => {
      state.height = height
      state.width = width
      if (below && observer && inset === 100) {
        // Preserve any old lines when the active paragraph grows below viewport.
        if (!state.pending) state.clip = unit.style.clipPath
        state.pending = true
        unit.style.clipPath = `inset(0 0 ${inset}% 0)`
        pending.add(unit)
        observer.observe(unit)
        return
      }
      if (inset <= 0) return
      expose(unit)
      if (!animate) return
      const frames = inset < 100
        ? [{ clipPath: `inset(0 0 ${inset}% 0)` }, { clipPath: 'inset(0 0 0% 0)' }]
        : height > 132
          ? [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }]
          : [{ opacity: 0 }, { opacity: 1 }]
      const animation = unit.animate(frames, {
        duration: SEMANTIC_REVEAL_MS,
        delay: inset < 100 ? 0 : Math.min(index * 35, 100),
        easing: 'ease-out', fill: 'backwards',
      })
      active.set(unit, animation)
      animation.onfinish = () => { if (active.get(unit) === animation) active.delete(unit) }
    })
    initial = false
    // The deadline starts once, not again for each delta/IntersectionObserver.
    if (enabled && !streaming && deadline == null) {
      deadline = setTimeout(() => { completionExpired = true; flush(); mutations?.disconnect() }, SEMANTIC_REVEAL_MAX_MS)
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
