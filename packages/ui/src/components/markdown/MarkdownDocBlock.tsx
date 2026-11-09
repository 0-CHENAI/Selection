/**
 * MarkdownDocBlock - Renders ```markdown-preview code blocks as inline rendered markdown.
 *
 * Loads markdown content from file(s) (via `src` or `items` field) and renders
 * it through the shared `Markdown` component. Supports multiple items with a
 * tab bar for switching between them.
 *
 * Expected JSON shapes:
 * Single item:
 * {
 *   "src": "/absolute/path/to/file.md",
 *   "title": "Optional title"
 * }
 *
 * Multiple items:
 * {
 *   "title": "Spec drafts",
 *   "items": [
 *     { "src": "/path/to/v1.md", "label": "v1" },
 *     { "src": "/path/to/v2.md", "label": "v2" }
 *   ]
 * }
 *
 * Recursion guard: the inner `Markdown` invocation passes
 * `disablePreviewBlocks={new Set(['markdown-preview'])}` so a nested
 * `markdown-preview` fence falls through to a regular code block instead of
 * recursing forever. Other preview blocks (datatable, mermaid, …) still work.
 */

import * as React from 'react'
import { FileText, Maximize2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { ItemNavigator } from '../overlay/ItemNavigator'
import { usePlatform } from '../../context/PlatformContext'
import { useTranslation } from 'react-i18next'
import { Markdown } from './Markdown'
import { PreviewOverlay } from '../overlay/PreviewOverlay'
import { InlineDocumentPreview } from './InlineDocumentPreview'
import {
  parseMarkdownPreviewSpec,
  normalizePreviewItems,
  type MarkdownPreviewItem,
} from './markdown-preview-helpers'

class MarkdownDocBlockErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) {
    console.warn('[MarkdownDocBlock] Render failed, falling back to CodeBlock:', error)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

const DISABLE_INNER_MARKDOWN_PREVIEW: ReadonlySet<'markdown-preview'> = new Set(['markdown-preview'])

export interface MarkdownDocBlockProps {
  code: string
  className?: string
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
}

export function MarkdownDocBlock({ code, className, onUrlClick, onFileClick }: MarkdownDocBlockProps) {
  const { t } = useTranslation()
  const { onReadFile } = usePlatform()

  const spec = React.useMemo(() => parseMarkdownPreviewSpec(code), [code])
  const items = React.useMemo<MarkdownPreviewItem[]>(() => normalizePreviewItems(spec), [spec])

  const [activeIndex, setActiveIndex] = React.useState(0)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  const [contentCache, setContentCache] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const selectedIndex = activeIndex < items.length ? activeIndex : 0
  const activeItem = items[selectedIndex]
  const activeContent = activeItem ? contentCache[activeItem.src] : undefined
  React.useEffect(() => { setActiveIndex(selectedIndex) }, [selectedIndex])

  React.useEffect(() => {
    if (!activeItem?.src || !onReadFile) return
    if (activeContent !== undefined) {
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
        setError(err instanceof Error ? err.message : 'Failed to read markdown file')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeItem?.src, onReadFile, activeContent])

  const fallback = <CodeBlock code={code} language="json" mode="full" className={className} />

  if (!spec || items.length === 0) {
    return fallback
  }

  const headerTitle = activeItem?.src.split(/[\\/]/).pop() || spec.title || t('preview.markdownPreview')

  return (
    <MarkdownDocBlockErrorBoundary fallback={fallback}>
      <div className={cn('relative group my-4 rounded-xl overflow-hidden border border-foreground/15 bg-background shadow-minimal', className)}>
        <div className="px-3 py-2 bg-muted/50 border-b flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span title={activeItem?.src} className="min-w-0 truncate text-[12px] text-foreground font-medium flex-1">{headerTitle}</span>
          <span className="text-xs text-muted-foreground">Markdown</span>
          <div className="flex items-center gap-1">
            <ItemNavigator items={items} activeIndex={selectedIndex} onSelect={setActiveIndex} />
            <button type="button" onClick={() => setIsFullscreen(true)} aria-label={t('common.viewFullscreen')}
              className="rounded p-1 hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring">
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        </div>

        <InlineDocumentPreview key={activeItem?.src} onViewFull={() => setIsFullscreen(true)}>
          <div className="relative px-3 py-2 overflow-x-auto">
            {activeContent !== undefined && (
              <Markdown
                mode="minimal"
                disablePreviewBlocks={DISABLE_INNER_MARKDOWN_PREVIEW}
                onUrlClick={onUrlClick}
                onFileClick={onFileClick}
              >
                {activeContent}
              </Markdown>
            )}

            {activeContent === undefined && loading && (
              <div className="py-8 text-center text-muted-foreground text-[13px]">{t('common.loading')}</div>
            )}

            {activeContent === undefined && !loading && error && (
              <div className="py-6 text-center text-destructive/70 text-[13px]">{error}</div>
            )}
          </div>
        </InlineDocumentPreview>
      </div>
      <PreviewOverlay isOpen={isFullscreen} onClose={() => setIsFullscreen(false)}
        typeBadge={{ icon: FileText, label: 'Markdown', variant: 'blue' }} filePath={activeItem?.src}
        headerActions={<ItemNavigator items={items} activeIndex={selectedIndex} onSelect={setActiveIndex} />}>
        <div className="mx-auto w-full max-w-5xl px-6 py-4 break-words">
          {activeContent !== undefined ? (
            <Markdown mode="full" disablePreviewBlocks={DISABLE_INNER_MARKDOWN_PREVIEW}
              onUrlClick={onUrlClick} onFileClick={onFileClick}>{activeContent}</Markdown>
          ) : <p className="text-sm text-muted-foreground">{error || t('common.loading')}</p>}
        </div>
      </PreviewOverlay>
    </MarkdownDocBlockErrorBoundary>
  )
}
