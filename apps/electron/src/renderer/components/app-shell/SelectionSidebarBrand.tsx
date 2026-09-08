import { SelectionWord } from '@/components/icons/SelectionWordmark'
import swanBlack from '@/assets/selection-swan-black.svg'
import swanWhite from '@/assets/selection-swan-white.svg'

export function SelectionSidebarBrand() {
  return (
    <div
      role="img"
      aria-label="Selection"
      data-testid="selection-sidebar-brand"
      className="flex h-12 w-full items-center justify-center overflow-hidden px-2 select-none"
    >
      <div className="flex max-w-full items-center justify-center gap-2.5 text-foreground">
        <img
          src={swanBlack}
          alt=""
          className="h-8 w-auto shrink-0 dark:hidden"
        />
        <img
          src={swanWhite}
          alt=""
          className="hidden h-8 w-auto shrink-0 dark:block"
        />
        <SelectionWord className="shrink-0 text-[1.8rem] leading-none" />
      </div>
    </div>
  )
}
