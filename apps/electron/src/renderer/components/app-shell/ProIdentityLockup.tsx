import { useLayoutEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import swan from '@/assets/selection-swan-trimmed.svg'
import wordmark from '@/assets/selection-wordmark.svg'

gsap.registerPlugin(CustomEase)
const microScaleEase = CustomEase.create('proMicroScaleFade', '0.32,0.72,0,1')

export default function ProIdentityLockup({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const isOpen = useRef(open)
  const animation = useRef<gsap.core.Timeline | null>(null)

  useLayoutEffect(() => {
    const media = gsap.matchMedia()
    media.add({ all: 'all', reduceMotion: '(prefers-reduced-motion: reduce)' }, context => {
      const reduced = context.conditions?.reduceMotion
      animation.current = gsap.timeline({ paused: !isOpen.current })
        .fromTo('.pro-identity-mode', {
          autoAlpha: 0,
          scale: reduced ? 1 : 0.98,
          transformOrigin: '50% 50%',
          '--pro-ink-progress': reduced ? '100%' : '0%',
        }, {
          autoAlpha: 1,
          scale: 1,
          '--pro-ink-progress': '100%',
          duration: reduced ? 0.15 : 1.1,
          ease: microScaleEase,
        }, reduced ? 0.65 : 1.5)
        .fromTo('.pro-identity-close', { autoAlpha: 0 }, {
          autoAlpha: 1,
          duration: reduced ? 0.15 : 0.2,
          ease: 'power2.out',
        }, '+=1')
    }, root)
    return () => {
      media.revert()
      animation.current = null
    }
  }, [])

  useLayoutEffect(() => {
    isOpen.current = open
    // Keep the current reveal frame while Radix retains the fading dialog.
    animation.current?.paused(!open)
  }, [open])

  return (
    <div ref={root} className="relative">
      <div className="pro-identity-lockup pointer-events-none flex items-end" aria-hidden="true">
        <div className="pro-identity-brand flex shrink-0 items-end">
          {/* Animate the wrappers so blur never overrides the image's theme inversion. */}
          <div className="pro-identity-mark"><img src={swan} alt="" draggable={false} className="h-full w-auto" /></div>
          <div className="pro-identity-label flex items-center">
            <div className="pro-identity-wordmark"><img src={wordmark} alt="" draggable={false} className="h-full w-auto" /></div>
            <svg className="pro-identity-mode" viewBox="32 10 104 34">
              <text x="84" y="40" textAnchor="middle" className="pro-identity-fill">PRO</text>
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
