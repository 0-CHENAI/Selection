/**
 * MarkdownHtmlBlock - Renders ```html-preview code blocks as sandboxed HTML previews.
 *
 * Loads HTML from file(s) (via `src` or `items` field) and renders in a sandboxed iframe.
 * Supports multiple items with a tab bar for switching between them.
 *
 * Expected JSON shapes:
 * Single item:
 * {
 *   "src": "/absolute/path/to/file.html",
 *   "title": "Optional title"
 * }
 *
 * Multiple items:
 * {
 *   "title": "Email Thread",
 *   "items": [
 *     { "src": "/path/to/email1.html", "label": "Original" },
 *     { "src": "/path/to/reply.html", "label": "Reply" }
 *   ]
 * }
 *
 * Flash prevention: All cached items are rendered as hidden iframes (display:none/block).
 * Switching tabs toggles CSS visibility — no re-parse, no flash.
 *
 * Security: iframe uses `sandbox` attribute without `allow-scripts`,
 * blocking all JavaScript execution. `allow-same-origin` is included
 * so CSS and images resolve correctly.
 */

import * as React from 'react'
import { Globe, Maximize2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { HTMLPreviewOverlay } from '../overlay/HTMLPreviewOverlay'
import { ItemNavigator } from '../overlay/ItemNavigator'
import { usePlatform } from '../../context/PlatformContext'
import { useTranslation } from 'react-i18next'
import { InlineDocumentPreview } from './InlineDocumentPreview'
import { InlineHtmlFrame } from './InlineHtmlFrame'
import { parseMarkdownPreviewSpec, normalizePreviewItems } from './markdown-preview-helpers'

// ── Error boundary ───────────────────────────────────────────────────────────

class HtmlBlockErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) {
    console.warn('[MarkdownHtmlBlock] Render failed, falling back to CodeBlock:', error)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// ── HTML preprocessing ───────────────────────────────────────────────────────

/**
 * Inject `<base target="_top">` into HTML so link clicks navigate the top frame
 * instead of the iframe. Combined with `allow-top-navigation-by-user-activation`
 * in the sandbox, this lets Electron's `will-navigate` handler intercept the
 * navigation and open the URL in the system browser.
 */
function injectBaseTarget(html: string): string {
  if (/<base\s/i.test(html)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, '$1<base target="_top">')
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, '$1<head><base target="_top"></head>')
  }
  return `<head><base target="_top"></head>${html}`
}

// ── Main component ───────────────────────────────────────────────────────────

export interface MarkdownHtmlBlockProps {
  code: string
  className?: string
}

export function MarkdownHtmlBlock({ code, className }: MarkdownHtmlBlockProps) {
  const { t } = useTranslation()
  const { onReadFile } = usePlatform()

  const spec = React.useMemo(() => parseMarkdownPreviewSpec(code), [code])
  const items = React.useMemo(() => normalizePreviewItems(spec), [spec])

  const [activeIndex, setActiveIndex] = React.useState(0)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  // Content cache: src path → loaded HTML string
  const [contentCache, setContentCache] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const selectedIndex = activeIndex < items.length ? activeIndex : 0
  const activeItem = items[selectedIndex]
  React.useEffect(() => { setActiveIndex(selectedIndex) }, [selectedIndex])
  const activeHtml = activeItem ? contentCache[activeItem.src] : undefined

  // Load active item's content when it changes
  React.useEffect(() => {
    if (!activeItem?.src || !onReadFile) return
    if (activeHtml !== undefined) {
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    onReadFile(activeItem.src)
      .then((content) => {
        if (cancelled) return
        setContentCache((prev) => ({ ...prev, [activeItem.src]: content }))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to read HTML file')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeItem?.src, onReadFile, activeHtml])

  // Preprocess all cached HTML (inject base target for links)
  const processedCache = React.useMemo(() => {
    const result: Record<string, string> = {}
    for (const [src, html] of Object.entries(contentCache)) {
      result[src] = injectBaseTarget(html)
    }
    return result
  }, [contentCache])

  // Stable onLoadContent callback for the overlay
  const handleLoadContent = React.useCallback(async (src: string) => {
    if (contentCache[src] !== undefined) return contentCache[src]
    if (!onReadFile) throw new Error('Cannot load content')
    const content = await onReadFile(src)
    setContentCache((prev) => ({ ...prev, [src]: content }))
    return content
  }, [contentCache, onReadFile])

  // Invalid spec → fall back to code block
  if (!spec || items.length === 0) {
    return <CodeBlock code={code} language="json" mode="full" className={className} />
  }

  const fallback = <CodeBlock code={code} language="json" mode="full" className={className} />

  return (
    <HtmlBlockErrorBoundary fallback={fallback}>
      <div className={cn('relative group my-4 rounded-xl overflow-hidden border border-foreground/15 bg-background shadow-minimal', className)}>
        {/* Header */}
        <div className="px-3 py-2 bg-muted/50 border-b flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span title={activeItem?.src} className="min-w-0 truncate text-[12px] text-foreground font-medium flex-1">
            {activeItem?.src.split(/[\\/]/).pop() || spec.title || t('preview.htmlPreview')}
          </span>
          <span className="text-xs text-muted-foreground">HTML</span>
          <div className="flex items-center gap-1">
            <ItemNavigator items={items} activeIndex={selectedIndex} onSelect={setActiveIndex} />
            <button
              type="button"
              aria-label={t('common.viewFullscreen')}
              onClick={() => setIsFullscreen(true)}
              className={cn(
                "p-1 rounded-[6px] transition-all select-none",
                "bg-background shadow-minimal",
                "text-muted-foreground/50 hover:text-foreground",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              )}
              title={t('common.viewFullscreen')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content area: hidden iframes for cached items + loading/error for uncached active */}
        <InlineDocumentPreview onViewFull={() => setIsFullscreen(true)}>
          {/* Render all cached items as hidden iframes — prevents flash on tab switch */}
          {items.map((item, i) => {
            const processed = processedCache[item.src]
            if (processed === undefined) return null
            return (
              <InlineHtmlFrame
                key={item.src}
                html={processed}
                title={item.label || spec.title || t('preview.htmlPreview')}
                active={i === selectedIndex}
              />
            )
          })}

          {/* Loading state for uncached active item */}
          {activeHtml === undefined && loading && (
            <div className="py-8 text-center text-muted-foreground text-[13px]">{t('common.loading')}</div>
          )}

          {/* Error state for uncached active item */}
          {activeHtml === undefined && !loading && error && (
            <div className="py-6 text-center text-destructive/70 text-[13px]">{error}</div>
          )}
        </InlineDocumentPreview>
      </div>

      {/* Fullscreen overlay — passes items for multi-item navigation */}
      <HTMLPreviewOverlay
        readingMode
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        items={items}
        contentCache={contentCache}
        onLoadContent={handleLoadContent}
        initialIndex={selectedIndex}
        title={spec.title}
      />
    </HtmlBlockErrorBoundary>
  )
}

