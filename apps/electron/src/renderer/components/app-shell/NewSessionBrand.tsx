import { SelectionWord } from '@/components/icons/SelectionWordmark'
import swanBlack from '@/assets/selection-swan-black.svg'
import swanWhite from '@/assets/selection-swan-white.svg'

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
      <div className="flex max-w-full items-center justify-center gap-3 text-foreground sm:gap-4">
        <img
          src={swanBlack}
          alt=""
          className="h-12 w-auto shrink-0 dark:hidden sm:h-16"
        />
        <img
          src={swanWhite}
          alt=""
          className="hidden h-12 w-auto shrink-0 dark:block sm:h-16"
        />
        <SelectionWord className="shrink-0 text-[2.35rem] leading-none sm:text-[3.2rem]" />
      </div>
    </div>
  )
}
