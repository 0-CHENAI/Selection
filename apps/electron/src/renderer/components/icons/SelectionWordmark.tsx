import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SelectionWordProps {
  className?: string
}

/** Product name set in bundled CATHALIE (Latin only). */
export function SelectionWord({ className }: SelectionWordProps) {
  return (
    <span
      className={cn('font-cathalie inline-block translate-y-[0.04em] text-[1.18em] font-normal tracking-[0.02em]', className)}
    >
      Selection
    </span>
  )
}

/** Replace the word "Selection" in a title with the CATHALIE wordmark. */
export function withSelectionMark(text: string): ReactNode {
  const parts = text.split(/(Selection)/g)
  if (parts.length === 1) return text
  return parts.map((part, index) => (
    part === 'Selection' ? <SelectionWord key={index} /> : part
  ))
}
