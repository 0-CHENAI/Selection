import * as React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface ConversationNavigationItem {
  key: string
  index: number
  title: string
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
      <nav ref={railRef} aria-label={t('chat.recordNavigation')}
        className="absolute left-0 top-[calc(50%-12px)] -translate-y-1/2 max-h-[calc(100%-4rem)] w-8 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item, index) => (
          <Tooltip.Root key={item.key}>
            <Tooltip.Trigger asChild>
              <button type="button" aria-label={t('chat.goToRecord', { number: index + 1, title: item.title })}
                aria-current={activeKey === item.key ? 'step' : undefined}
                onClick={() => onNavigate(item)}
                className="group flex h-3 w-8 items-center pl-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
                <span className={cn('h-0.5 w-2 origin-left bg-foreground/25 transition-transform duration-150 motion-reduce:transition-none group-hover:scale-x-200 group-hover:bg-foreground/70 group-focus-visible:scale-x-200',
                  activeKey === item.key && 'scale-x-250 bg-foreground/80')} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={12} collisionPadding={16}
                className="z-dropdown w-80 max-w-[calc(100vw-4rem)] rounded-2xl border border-border bg-background p-4 text-sm text-foreground shadow-modal-small">
                <div className="line-clamp-2 break-words font-medium">{item.title || t('chat.recordFallback', { number: index + 1 })}</div>
                {item.preview && <div className="mt-2 line-clamp-3 break-words text-muted-foreground">{item.preview}</div>}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </nav>
    </Tooltip.Provider>
  )
}
