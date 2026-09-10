import * as React from 'react'

export const SEMANTIC_REVEAL_MS = 180
export const SEMANTIC_REVEAL_MAX_MS = 420
const played = new Set<string>()
// Shared Markdown also renders in static previews; only the browser needs a
// pre-paint effect. Keep server rendering free of layout-effect warnings.
const useBrowserLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/** Select leaves at semantic block boundaries, not fragments of Markdown source. */
export function getRevealUnits(root: HTMLElement): HTMLElement[] {
  const selector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,table,[data-ca-block-type]'
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(element => {
    // A list item/quote/preview is one unit; don't animate its descendants twice.
    const parent = element.parentElement?.closest(selector)
    return !parent || !root.contains(parent)
  })
}

/** Full DOM is always present. Animations never schedule rendering or scrolling. */
export function useSemanticReveal(
  root: React.RefObject<HTMLDivElement>,
  content: string,
  startTime: number | undefined,
  streaming: boolean,
  identity?: string,
) {
  const seen = React.useRef(new WeakSet<HTMLElement>())
  const active = React.useRef(new Set<Animation>())
  const allowed = React.useRef<boolean | null>(null)
  const stopped = React.useRef(false)
  const cancel = React.useCallback(() => {
    stopped.current = true
    active.current.forEach(animation => animation.cancel())
    active.current.clear()
  }, [])

  const previousIdentity = React.useRef(identity)
  useBrowserLayoutEffect(() => {
    // StrictMode replays setup after cleanup; replay visual setup, not admission.
    return () => {
      active.current.forEach(animation => animation.cancel())
      active.current.clear()
      seen.current = new WeakSet()
    }
  }, [])

  useBrowserLayoutEffect(() => {
    if (previousIdentity.current !== identity) {
      active.current.forEach(animation => animation.cancel())
      active.current.clear()
      seen.current = new WeakSet()
      allowed.current = null
      stopped.current = false
      previousIdentity.current = identity
    }
    const element = root.current
    if (!element) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (allowed.current === null) {
      // Production callers supply message identity. Keep the fallback bounded
      // too: never retain a whole response in the process-wide replay ledger.
      const key = identity ?? (startTime != null ? `time:${startTime}` : undefined)
      allowed.current = (streaming || (startTime != null && Date.now() - startTime < SEMANTIC_REVEAL_MAX_MS)) && (key == null || !played.has(key))
      if (allowed.current && key != null) {
        played.add(key)
        // Old timestamps already fail the freshness guard; bound process memory.
        if (played.size > 512) played.delete(played.values().next().value!)
      }
    }
    if (!allowed.current || stopped.current) return
    const units = getRevealUnits(element)
    const fresh = units.filter(unit => !seen.current.has(unit))
    units.forEach(unit => seen.current.add(unit))
    if (motion.matches) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    // Bound synchronous layout reads/animations even for book-length replies.
    // Read all geometry before writing any animation styles.
    const measured = fresh.slice(0, 32).flatMap(unit => {
      if (typeof unit.animate !== 'function') return []
      const rect = unit.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) return []
      const lineHeight = parseFloat(window.getComputedStyle(unit).lineHeight) || 22
      return [{ unit, lines: Math.ceil(rect.height / lineHeight) }]
    })
    measured.forEach(({ unit, lines }, index) => {
      const delay = Math.min(index * 35, SEMANTIC_REVEAL_MAX_MS - SEMANTIC_REVEAL_MS)
      // Tall units reveal by measured visual lines without wrapping or splitting
      // text nodes (links, selection, code highlighting and tables stay intact).
      const frames: Keyframe[] = lines > 6
        ? [{ opacity: 0.35, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0% 0)' }]
        : [{ opacity: 0 }, { opacity: 1 }]
      const animation = unit.animate(frames, {
        duration: SEMANTIC_REVEAL_MS, delay, fill: 'backwards',
        easing: lines > 6 ? `steps(${Math.min(lines, 12)}, end)` : 'ease-out',
      })
      active.current.add(animation)
      animation.onfinish = () => { active.current.delete(animation) }
    })
  }, [content, startTime, streaming, root, identity])

  React.useEffect(() => {
    const element = root.current
    if (!element || !allowed.current) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionChanged = () => { if (motion.matches) cancel() }
    const selectionChanged = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      // Selection may start outside this Markdown (Ctrl+A / cross-message
      // selection), so the anchor alone does not describe the selected range.
      for (let index = 0; index < selection.rangeCount; index += 1) {
        if (selection.getRangeAt(index).intersectsNode(element)) {
          cancel()
          break
        }
      }
    }
    // Any manual navigation ends cosmetic playback; never pull readers back.
    element.addEventListener('pointerdown', cancel)
    element.addEventListener('focusin', cancel)
    window.addEventListener('wheel', cancel, { passive: true })
    window.addEventListener('touchmove', cancel, { passive: true })
    window.addEventListener('keydown', cancel)
    document.addEventListener('selectionchange', selectionChanged)
    motion.addEventListener('change', motionChanged)
    return () => {
      element.removeEventListener('pointerdown', cancel)
      element.removeEventListener('focusin', cancel)
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchmove', cancel)
      window.removeEventListener('keydown', cancel)
      document.removeEventListener('selectionchange', selectionChanged)
      motion.removeEventListener('change', motionChanged)
    }
  }, [cancel, root, identity])
}
