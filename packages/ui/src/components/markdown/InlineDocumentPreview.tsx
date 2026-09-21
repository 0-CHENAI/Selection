import * as React from 'react'
import { Maximize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Keep the header/actions outside the clipped document, without nested vertical scrolling. */
export function InlineDocumentPreview({ children, onViewFull }: {
  children: React.ReactNode
  onViewFull: () => void
}) {
  const { t } = useTranslation()
  const previewRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = React.useState(false)
  const contentId = React.useId()

  React.useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const measure = () => {
      const limit = Math.min(400, window.innerHeight * 0.5)
      setOverflowing(content.scrollHeight > limit + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <div ref={previewRef}>
      <div
        className="relative overflow-hidden"
        style={{ maxHeight: 'min(400px, 50vh)' }}
      >
        <div id={contentId} ref={contentRef} className="flow-root">{children}</div>
        {overflowing && (
          <div
            aria-hidden="true"
            data-preview-fade=""
            className="absolute bottom-0 inset-x-0 h-12 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, transparent, var(--background))' }}
          />
        )}
      </div>
      {overflowing && (
        <div className="flex justify-center border-t bg-background px-3 py-1.5">
          <button
            type="button"
            aria-controls={contentId}
            onClick={onViewFull}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Maximize2 className="size-3.5" />
            {t('common.viewFullscreen')}
          </button>
        </div>
      )}
    </div>
  )
}
