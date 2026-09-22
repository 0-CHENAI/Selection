import * as React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useTranslation } from 'react-i18next'
import { renderContentWithBadges, markdownToPlainText } from '@craft-agent/ui'
import type { ContentBadge } from '@craft-agent/core'
import { cn } from '@/lib/utils'
import { getConversationNavigationTitlePreview } from './conversation-navigation-preview'

export interface ConversationNavigationItem {
  key: string
  index: number
  title: string
  badges?: ContentBadge[]
  preview: string
}

interface Props {
  items: ConversationNavigationItem[]
  viewportRef: React.RefObject<HTMLDivElement>
  turnRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  onNavigate: (item: ConversationNavigationItem) => void
}

/** The rail has its own bounded scroll area so every record remains reachable. */
export function ConversationNavigation({ items, viewportRef, turnRefs, onNavigate }: Props) {
  const { t } = useTranslation()
  const [activeKey, setActiveKey] = React.useState<string>()
  const railRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    const update = () => {
      frame = 0
      const top = viewport.getBoundingClientRect().top + 48
      let current: string | undefined
      for (const item of items) {
        const element = turnRefs.current.get(item.key)
        if (!element || !viewport.contains(element)) continue
        if (!current) current = item.key
        if (element.getBoundingClientRect().top <= top) current = item.key
        else break
      }
      // The final record may be too short to align with the viewport top.
      if (viewport.scrollHeight > viewport.clientHeight && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 2) {
        current = items.at(-1)?.key
      }
      setActiveKey(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(viewport)
    if (viewport.firstElementChild) resize.observe(viewport.firstElementChild)
    // History can mount after the session exit animation has finished.
    const mutation = new MutationObserver(schedule)
    mutation.observe(viewport, { childList: true, subtree: true })
    viewport.addEventListener('scroll', schedule, { passive: true })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      viewport.removeEventListener('scroll', schedule)
    }
  }, [items, viewportRef, turnRefs])

  React.useEffect(() => {
    const rail = railRef.current
    const active = rail?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!rail || !active || rail.matches(':hover') || rail.contains(document.activeElement)) return
    // Only move the rail, never the conversation or an ancestor panel.
    rail.scrollTop = active.offsetTop - rail.clientHeight / 2
  }, [activeKey])

  if (items.length === 0) return null

  return (
    <Tooltip.Provider delayDuration={180} disableHoverableContent>
      <div className="pointer-events-none absolute left-0 top-[calc(20%-12px)] bottom-[calc(20%+12px)] flex w-8 min-w-8 items-center">
      <nav ref={railRef} aria-label={t('chat.recordNavigation')}
        className="pointer-events-auto relative max-h-full w-8 min-w-8 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item, index) => {
          const titlePreview = getConversationNavigationTitlePreview(item.title, item.badges ?? [])

          return (
            <Tooltip.Root key={item.key}>
              <Tooltip.Trigger asChild>
                <button type="button" aria-label={t('chat.goToRecord', { number: index + 1, title: markdownToPlainText(item.title) })}
                  aria-current={activeKey === item.key ? 'step' : undefined}
                  onClick={() => onNavigate(item)}
                  className="group flex h-3 w-8 items-center pl-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className={cn('h-0.5 w-2 origin-left bg-foreground/25 transition-transform duration-150 motion-reduce:transition-none group-hover:scale-x-200 group-hover:bg-foreground/70 group-focus-visible:scale-x-200',
                    activeKey === item.key && 'scale-x-250 bg-foreground/80')} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={12} collisionPadding={16}
                  className="z-dropdown w-80 max-w-[min(calc(100vw-4rem),var(--radix-tooltip-content-available-width))] max-h-[var(--radix-tooltip-content-available-height)] overflow-hidden rounded-2xl border border-border bg-background p-4 text-sm text-foreground shadow-modal-small">
                  <div className="min-w-0 line-clamp-1 font-medium [&_p]:inline [&_div]:inline [&_pre]:inline [&_img]:max-h-5">
                    {titlePreview.content ? renderContentWithBadges(titlePreview.content, titlePreview.badges) : t('chat.recordFallback', { number: index + 1 })}
                  </div>
                  {item.preview && (
                    <div className="mt-2 line-clamp-3 [overflow-wrap:anywhere] text-muted-foreground">
                      {markdownToPlainText(item.preview).replace(/\s+/g, ' ')}
                    </div>
                  )}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )
        })}
      </nav>
      </div>
    </Tooltip.Provider>
  )
}
