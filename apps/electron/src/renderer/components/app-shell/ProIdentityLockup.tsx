import { useId, useLayoutEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import swan from '@/assets/selection-swan-trimmed.svg'
import wordmark from '@/assets/selection-wordmark.svg'

gsap.registerPlugin(CustomEase)
const microScaleEase = CustomEase.create('proMicroScaleFade', '0.32,0.72,0,1')
// Smooth speed, acceleration, and jerk, including the transition through the peak.
const edgeOrbitEase = (progress: number) =>
  progress ** 4 * (35 + progress * (-84 + progress * (70 - 20 * progress)))

export default function ProIdentityLockup({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const isOpen = useRef(open)
  const animation = useRef<gsap.core.Timeline | null>(null)
  const light = useRef<gsap.core.Tween | null>(null)
  const glassId = useId()

  useLayoutEffect(() => {
    const media = gsap.matchMedia()
    media.add({ all: 'all', reduceMotion: '(prefers-reduced-motion: reduce)' }, context => {
      const reduced = context.conditions?.reduceMotion
      animation.current = gsap.timeline({ paused: !isOpen.current })
        .fromTo('.pro-identity-mode', {
          '--pro-ink-opacity': 0,
          scale: reduced ? 1 : 0.98,
          transformOrigin: '50% 50%',
          '--pro-ink-progress': reduced ? '100%' : '0%',
        }, {
          '--pro-ink-opacity': 1,
          scale: 1,
          '--pro-ink-progress': '100%',
          // Let the lettering form at the same pace as the edge light travels.
          duration: reduced ? 0.15 : 1.8,
          ease: reduced ? microScaleEase : edgeOrbitEase,
        }, reduced ? 0.25 : 1.1)
      if (!reduced) {
        animation.current
          .set('.pro-identity-edge-trace', { opacity: 1, strokeDashoffset: 0, strokeDasharray: '0 96' }, 1.1)
          .to('.pro-identity-edge-trace', { strokeDasharray: '18 78', duration: 0.4, ease: edgeOrbitEase }, 1.1)
          .to('.pro-identity-edge-trace', { strokeDashoffset: -96, duration: 1.8, ease: edgeOrbitEase }, 1.1)
          .to('.pro-identity-edge-trace', { opacity: 0, duration: 0.3, ease: 'sine.inOut' }, 2.6)
      }
      animation.current.fromTo('.pro-identity-close', { autoAlpha: 0 }, {
        autoAlpha: 1,
        duration: reduced ? 0.15 : 0.2,
        ease: 'power2.out',
      }, '+=0.5')
      light.current = reduced ? null : gsap.to('.pro-identity-reflection', {
        attr: { gradientTransform: 'rotate(332 84 27)' },
        duration: 6.4,
        delay: 2.9,
        repeat: -1,
        ease: edgeOrbitEase,
        paused: !isOpen.current,
      })
    }, root)
    return () => {
      media.revert()
      animation.current = null
      light.current = null
    }
  }, [])

  useLayoutEffect(() => {
    isOpen.current = open
    // Keep the current reveal frame while Radix retains the fading dialog.
    animation.current?.paused(!open)
    light.current?.paused(!open)
  }, [open])

  return (
    <div ref={root} className="relative">
      <div className="pro-identity-lockup pointer-events-none flex items-end" aria-hidden="true">
        <div className="pro-identity-brand flex shrink-0 items-end">
          {/* Animate the wrappers so blur never overrides the image's theme inversion. */}
          <div className="pro-identity-mark"><img src={swan} alt="" draggable={false} className="h-full w-auto" /></div>
          <div className="pro-identity-label flex items-center">
            <div className="pro-identity-wordmark"><img src={wordmark} alt="" draggable={false} className="h-full w-auto" /></div>
            <svg className="pro-identity-mode font-cathalie" viewBox="32 10 104 34">
              <defs>
                <text id={`${glassId}-glyph`} x="84" y="40" textAnchor="middle">PRO</text>
                <linearGradient id={`${glassId}-body`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--pro-glass-highlight)" />
                  <stop offset="0.24" stopColor="currentColor" stopOpacity="0.85" />
                  <stop offset="0.47" stopColor="var(--pro-glass-highlight)" stopOpacity="0.8" />
                  <stop offset="0.54" stopColor="currentColor" stopOpacity="0.42" />
                  <stop offset="0.8" stopColor="currentColor" stopOpacity="0.95" />
                  <stop offset="1" stopColor="var(--pro-glass-highlight)" />
                </linearGradient>
                <linearGradient id={`${glassId}-light`} className="pro-identity-reflection"
                  gradientUnits="userSpaceOnUse" x1="32" y1="27" x2="136" y2="27" gradientTransform="rotate(-28 84 27)">
                  <stop offset="0.45" stopColor="var(--pro-glass-reflection)" stopOpacity="0" />
                  <stop offset="0.72" stopColor="var(--pro-glass-reflection)" stopOpacity="0.3" />
                  <stop offset="0.84" stopColor="var(--pro-glass-reflection)" />
                  <stop offset="1" stopColor="var(--pro-glass-reflection)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g className="pro-identity-ink">
                <use href={`#${glassId}-glyph`} fill={`url(#${glassId}-body)`} className="pro-identity-glass" />
                <use href={`#${glassId}-glyph`} fill={`url(#${glassId}-light)`} opacity="0.45" />
                <use href={`#${glassId}-glyph`} fill="none" stroke={`url(#${glassId}-light)`} strokeWidth="0.65" />
              </g>
              <use href={`#${glassId}-glyph`} className="pro-identity-edge-trace" fill="none"
                stroke="var(--pro-glass-reflection)" strokeWidth="1.1" strokeLinecap="round" strokeDasharray="18 78" />
            </svg>
          </div>
        </div>
      </div>
      <Dialog.Close asChild>
        <button type="button" aria-label={t('common.close')}
          className="pro-identity-close absolute left-1/2 top-full mt-8 flex size-9 -translate-x-1/2 items-center justify-center rounded-full text-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pro-accent)]">
          <X className="size-5" />
        </button>
      </Dialog.Close>
    </div>
  )
}
