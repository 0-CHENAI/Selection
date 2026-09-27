/** File-backed HTML opens in the platform browser; never execute it inside chat. */
import * as React from 'react'
import { Globe, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { usePlatform } from '../../context/PlatformContext'
import { CodeBlock } from './CodeBlock'
import { ItemNavigator } from '../overlay/ItemNavigator'
import { parseMarkdownPreviewSpec, normalizePreviewItems } from './markdown-preview-helpers'

export interface MarkdownHtmlBlockProps { code: string; className?: string }

export function MarkdownHtmlBlock({ code, className }: MarkdownHtmlBlockProps) {
  const { t } = useTranslation()
  const { onOpenFile } = usePlatform()
  const spec = React.useMemo(() => parseMarkdownPreviewSpec(code), [code])
  const items = React.useMemo(() => normalizePreviewItems(spec), [spec])
  const [activeIndex, setActiveIndex] = React.useState(0)
  const selectedIndex = activeIndex < items.length ? activeIndex : 0
  const item = items[selectedIndex]

  if (!spec || !item) return <CodeBlock code={code} language="json" mode="full" className={className} />

  return (
    <div className={cn('my-4 flex items-center gap-2 rounded-xl border border-foreground/10 bg-muted/30 px-3 py-2', className)}>
      <Globe className="size-4 shrink-0 text-muted-foreground" />
      <span title={item.src} className="min-w-0 flex-1 truncate text-sm">{item.label || spec.title || item.src.split(/[\\/]/).pop()}</span>
      <ItemNavigator items={items} activeIndex={selectedIndex} onSelect={setActiveIndex} />
      <button type="button" disabled={!onOpenFile} onClick={() => onOpenFile?.(item.src)} className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded disabled:opacity-50">
        {t('preview.openInBrowser')}<ArrowUpRight className="size-3.5" />
      </button>
    </div>
  )
}
