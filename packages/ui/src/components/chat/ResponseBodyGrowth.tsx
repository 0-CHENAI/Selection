import * as React from 'react'
import { useReducedMotion } from 'motion/react'

const useBrowserLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/** Animate only received content's layout; the outer card and footer stay anchored. */
export function ResponseBodyGrowth({ streaming, children }: { streaming: boolean; children: React.ReactNode }) {
  const outer = React.useRef<HTMLDivElement>(null)
  const inner = React.useRef<HTMLDivElement>(null)
  const live = React.useRef(streaming)
  const animateGrowth = streaming || live.current
  live.current = animateGrowth
  const reduceMotion = useReducedMotion()

  useBrowserLayoutEffect(() => {
    const shell = outer.current
    const content = inner.current
    if (!shell || !content || !animateGrowth || reduceMotion || typeof ResizeObserver === 'undefined') return
    let previous = content.getBoundingClientRect().height
    shell.style.height = `${previous}px`
    shell.style.overflow = 'clip'
    const observer = new ResizeObserver(() => {
      const height = content.getBoundingClientRect().height
      if (Math.abs(height - previous) < 0.5) return
      // CSS retargets an in-flight transition from its current visible height.
      // The transcript's ResizeObserver pins each intermediate frame; the
      // longer ease-out tail settles gently without overshoot or bouncing.
      shell.style.transition = height > previous ? 'height 620ms cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none'
      shell.style.height = `${height}px`
      previous = height
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
      shell.style.removeProperty('height')
      shell.style.removeProperty('transition')
      shell.style.removeProperty('overflow')
    }
  }, [reduceMotion, animateGrowth])

  return <div ref={outer}><div ref={inner} className="flow-root">{children}</div></div>
}
