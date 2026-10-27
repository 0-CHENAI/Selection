import { FileText, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Retained documents stay visible while their preview is being resumed. */
export function OfficePreviewLoading({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  if (compact) return <div role="status" className="pointer-events-none absolute inset-x-3 top-4 z-[3] flex justify-center">
    <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-background/95 px-4 py-2.5 text-xs font-medium text-accent shadow-middle ring-1 ring-border/50 backdrop-blur-sm">
      <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
      <span>{t('chat.officePreview.loading')}</span>
    </div>
  </div>

  return <div role="status" className="flex min-h-0 flex-1 items-center justify-center p-6">
    <div className="max-w-full -translate-y-4 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
      <div aria-hidden="true" className="relative mx-auto mb-6 h-40 w-36">
        <div className="absolute inset-2 rounded-full bg-accent/10 blur-2xl motion-safe:animate-pulse" />
        <div className="relative mx-auto flex h-36 w-28 flex-col gap-2.5 rounded-xl bg-background p-4 shadow-middle ring-1 ring-border/70">
          <div className="mb-1 flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent"><FileText className="size-4" /></div>
          <div className="space-y-2.5 motion-safe:animate-pulse">
            <div className="h-1.5 w-4/5 rounded-full bg-foreground/15" />
            <div className="h-1.5 rounded-full bg-foreground/8" />
            <div className="h-1.5 w-5/6 rounded-full bg-foreground/8" />
            <div className="h-1.5 w-3/5 rounded-full bg-accent/20" />
          </div>
        </div>
        <div className="absolute bottom-1 right-1 flex size-10 items-center justify-center rounded-full bg-background text-accent shadow-middle ring-1 ring-border/50">
          <LoaderCircle className="size-5 motion-safe:animate-spin" />
        </div>
      </div>
      <p className="text-sm font-medium text-foreground">{t('chat.officePreview.loading')}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{t('chat.officePreview.loadingHint')}</p>
    </div>
  </div>
}
