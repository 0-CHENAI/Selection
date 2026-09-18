import { useEffect, useLayoutEffect, type RefObject } from 'react'
import {
  applyRevealBudget,
  computeAdaptiveQueueStep,
  countCodePoints,
  nextHeightFloor,
  reconcileShown,
} from '../chat/stream-reveal'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const SKIP = 'script,style,textarea,input,button,[aria-hidden="true"]'

/**
 * Pace visible Text nodes after React commits.
 *
 * Character-level React state re-parses the whole Markdown document every
 * frame and reads as hitching. This hook leaves the React tree alone and only
 * writes `node.data`, so token updates can stay at source cadence.
 */
export function useProgressiveDomText(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useBrowserLayoutEffect(() => {
    const root = rootRef.current
    if (!root || typeof document === 'undefined') return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!enabled || motion.matches) return

    const fulls = new Map<Text, string>()
    const internal = new WeakMap<Text, string>()
    let shown = 0
    let revealed = ''
    let initialized = false
    let pinned = false
    let heightFloor = 0
    const previousMinHeight = root.style.minHeight
    let debt = 0
    let raf = 0
    let lastTs = 0
    let stopped = false
    let ticking = false

    const skip = (node: Text) => {
      const parent = node.parentElement
      return !parent || !root.contains(parent) || parent.closest(SKIP) !== null
    }

    const collect = () => {
      const nodes: Text[] = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text
        if (!skip(text)) nodes.push(text)
      }
      return nodes
    }

    const snapshot = (nodes: Text[]) => {
      for (const node of nodes) {
        if (internal.get(node) === node.data) continue
        fulls.set(node, node.data)
      }
      for (const node of [...fulls.keys()]) {
        if (!node.isConnected || skip(node)) fulls.delete(node)
      }
    }

    const apply = () => {
      const nodes = collect()
      snapshot(nodes)
      const sources = nodes.map(node => fulls.get(node) ?? node.data)
      const full = sources.join('')
      const target = countCodePoints(full)
      if (!initialized) {
        shown = target
        initialized = true
      } else if (pinned) {
        shown = target
      } else {
        shown = reconcileShown(revealed, full, shown)
      }
      shown = Math.min(shown, target)
      const parts = applyRevealBudget(sources, shown)
      revealed = parts.join('')
      nodes.forEach((node, index) => {
        const next = parts[index] ?? ''
        if (node.data === next) return
        internal.set(node, next)
        node.data = next
      })
      heightFloor = nextHeightFloor(heightFloor, root.getBoundingClientRect().height)
      if (heightFloor > 0) root.style.minHeight = `${heightFloor}px`
      return target
    }

    const tick = (now: number) => {
      raf = 0
      ticking = true
      if (stopped || pinned) {
        ticking = false
        return
      }
      const target = apply()
      const backlog = target - shown
      if (backlog <= 0) {
        lastTs = 0
        ticking = false
        return
      }
      const elapsed = lastTs ? now - lastTs : 16
      lastTs = now
      const step = computeAdaptiveQueueStep(backlog, elapsed, debt)
      debt = step.debt
      if (step.revealChars > 0) shown = Math.min(target, shown + step.revealChars)
      apply()
      ticking = false
      if (shown < target) raf = requestAnimationFrame(tick)
    }

    const schedule = () => {
      apply()
      if (!pinned && !raf && !ticking) raf = requestAnimationFrame(tick)
    }

    apply()
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(schedule)
    observer?.observe(root, { subtree: true, childList: true, characterData: true })

    const pin = () => {
      pinned = true
      apply()
    }
    const selectionChanged = () => {
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(root)) {
        pin()
      }
    }
    root.addEventListener('pointerdown', pin)
    document.addEventListener('selectionchange', selectionChanged)

    return () => {
      stopped = true
      if (raf) cancelAnimationFrame(raf)
      observer?.disconnect()
      root.removeEventListener('pointerdown', pin)
      document.removeEventListener('selectionchange', selectionChanged)
      for (const [node, full] of fulls) {
        if (node.isConnected) node.data = full
      }
      if (previousMinHeight) root.style.minHeight = previousMinHeight
      else root.style.removeProperty('min-height')
    }
  }, [enabled, rootRef])
}
