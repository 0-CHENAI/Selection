import { OFFICE_PREVIEW_MAX_SELECTION } from '@craft-agent/shared/protocol'
import { LoaderCircle, MousePointer2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Floating 「已选 N / 256」 pill. It sits above the preview document (z-[1]) and the resize mask (z-[2]). */
export function OfficeSelectionCapsule({ count, busy = false }: { count: number; busy?: boolean }) {
  const { t } = useTranslation()
  const overflow = count > OFFICE_PREVIEW_MAX_SELECTION
  const tone = overflow
    ? 'text-destructive ring-destructive/30'
    : count > 0
      ? 'text-accent ring-accent/25'
      : 'text-foreground ring-border'
  return <div
    role="status"
    data-testid="office-selection-capsule"
    data-office-selection-count={count}
    aria-atomic="true"
    aria-label={t('chat.officePreview.selectionCountLabel', { count, max: OFFICE_PREVIEW_MAX_SELECTION })}
    className="pointer-events-none absolute inset-x-3 bottom-8 z-[3] flex justify-center peer-data-[office-resizing=true]/office-viewport:hidden">
    <div className={`inline-flex items-center gap-2 rounded-full bg-background px-5 py-2.5 text-sm font-medium shadow-middle ring-1 ${tone}`}>
      {busy ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : <MousePointer2 aria-hidden="true" className="size-4" />}
      <span className="tabular-nums">{t('chat.officePreview.selectionCount', { count, max: OFFICE_PREVIEW_MAX_SELECTION })}</span>
    </div>
  </div>
}
