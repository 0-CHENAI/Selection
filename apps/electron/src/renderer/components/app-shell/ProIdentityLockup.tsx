import { useId, useLayoutEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { gsap } from 'gsap'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePlatform } from '@craft-agent/ui'
import swan from '@/assets/selection-swan-trimmed.svg'
import wordmark from '@/assets/selection-wordmark.svg'
import { ProIdentityGlyph } from './ProIdentityGlyph'
import { addProIdentityLockupReveal, edgeOrbitEase, PRO_IDENTITY_REDUCED_INK_DURATION } from './pro-identity-motion'

export default function ProIdentityLockup({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { onSetTrafficLightsVisible } = usePlatform()
  const root = useRef<HTMLDivElement>(null)
  const isOpen = useRef(open)
  const animation = useRef<gsap.core.Timeline | null>(null)
  const light = useRef<gsap.core.Tween | null>(null)
  const glassId = useId()

  // Native window controls sit above HTML; restore them after the portal's exit.
  useLayoutEffect(() => {
    onSetTrafficLightsVisible?.(false)
    return () => onSetTrafficLightsVisible?.(true)
  }, [onSetTrafficLightsVisible])

  useLayoutEffect(() => {
    const media = gsap.matchMedia()
    media.add({ all: 'all', reduceMotion: '(prefers-reduced-motion: reduce)' }, context => {
      const reduced = context.conditions?.reduceMotion
      animation.current = gsap.timeline({ paused: !isOpen.current })
      addProIdentityLockupReveal(animation.current, reduced)
      animation.current.fromTo('.pro-identity-close', { autoAlpha: 0 }, {
        autoAlpha: 1,
        duration: reduced ? PRO_IDENTITY_REDUCED_INK_DURATION : 0.2,
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
          <div className="pro-identity-label flex items-end">
            <div className="pro-identity-wordmark"><img src={wordmark} alt="" draggable={false} className="h-full w-auto" /></div>
            <ProIdentityGlyph id={glassId} />
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
