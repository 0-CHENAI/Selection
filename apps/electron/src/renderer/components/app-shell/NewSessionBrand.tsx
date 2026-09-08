import swan from '@/assets/selection-swan-trimmed.svg'
import wordmark from '@/assets/selection-wordmark.svg'

interface NewSessionBrandVisibility {
  compactMode: boolean
  hideComposer: boolean
  messagesLoading: boolean
  messagesLoadError?: string | null
  messageCount: number
  sessionBusy: boolean
}

export function shouldShowNewSessionBrand({
  compactMode,
  hideComposer,
  messagesLoading,
  messagesLoadError,
  messageCount,
  sessionBusy,
}: NewSessionBrandVisibility): boolean {
  return !compactMode
    && !hideComposer
    && !messagesLoading
    && !messagesLoadError
    && messageCount === 0
    && !sessionBusy
}

export function NewSessionBrand() {
  return (
    <div
      role="img"
      aria-label="Selection"
      data-testid="new-session-brand"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden px-6 select-none"
    >
      <div className="flex max-w-full scale-[0.75] items-end justify-center gap-3.5 text-foreground sm:gap-5">
        {/* Tight SVG bounds keep spacing precise; lift the wordmark slightly for optical balance. */}
        <img
          src={swan}
          alt=""
          className="h-[41.025px] w-auto shrink-0 dark:invert sm:h-[54.7px]"
        />
        <img
          src={wordmark}
          alt=""
          className="h-[24.2px] w-auto shrink-0 -translate-y-[2px] dark:invert sm:h-[33px] sm:-translate-y-[3px]"
        />
      </div>
    </div>
  )
}
