import { flushSync } from 'react-dom'
import { NAVIGATE_EVENT } from './navigate'

let cancelActive: (() => void) | undefined

export function cancelWorkModeTransition(): void {
  cancelActive?.()
  cancelActive = undefined
}

/** Keep the outgoing pixels until the incoming view is painted, without mounting a second chat. */
export async function transitionWorkMode(update: () => void): Promise<void> {
  cancelWorkModeTransition()
  const root = document.documentElement
  let cancelled = false
  let transition: ViewTransition | undefined
  let animations: Animation[] = []
  const cleanup = () => {
    window.removeEventListener(NAVIGATE_EVENT, cancel)
    delete root.dataset.workModeTransitionPhase
  }
  const cancel = () => {
    cancelled = true
    transition?.skipTransition()
    animations.forEach(animation => animation.cancel())
    cleanup()
  }
  const commit = () => {
    if (cancelled) return
    // Do not cancel the transition for its own navigation event.
    window.removeEventListener(NAVIGATE_EVENT, cancel)
    flushSync(update)
    window.addEventListener(NAVIGATE_EVENT, cancel)
  }
  cancelActive = cancel
  window.addEventListener(NAVIGATE_EVENT, cancel)
  root.dataset.workModeTransitionPhase = 'capture'
  try {
    if (typeof document.startViewTransition === 'function') {
      transition = document.startViewTransition(commit)
      // Skipped/rapid transitions reject ready even when the state update succeeds.
      void transition.ready.then(() => {
        if (!cancelled) root.dataset.workModeTransitionPhase = 'animate'
      }).catch(() => {})
      await transition.finished
    } else {
      commit()
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      animations = Array.from(document.querySelectorAll<HTMLElement>('[data-work-mode-transition]'))
        .filter(element => typeof element.animate === 'function')
        .map(element => element.animate(reduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0px)' }],
        { duration: reduced ? 150 : 360, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }))
      await Promise.allSettled(animations.map(animation => animation.finished))
    }
  } finally {
    if (cancelActive === cancel) { cleanup(); cancelActive = undefined }
  }
}
