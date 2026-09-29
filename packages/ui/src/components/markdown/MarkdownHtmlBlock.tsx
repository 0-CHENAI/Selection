/** File-backed HTML opens in the platform browser; never execute it inside chat. */
import * as React from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { usePlatform } from '../../context/PlatformContext'
import { CodeBlock } from './CodeBlock'
import { ItemNavigator } from '../overlay/ItemNavigator'
import { FileTypeIcon } from '../chat/attachment-helpers'
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

  const title = item.label || spec.title || item.src.split(/[\\/]/).pop() || item.src
  const fileName = item.src.split(/[\\/]/).pop() || item.src

  return (
    <div className={cn('my-3 flex w-full min-w-0 flex-wrap items-center gap-2 rounded-xl border border-success/20 bg-success/[0.045] p-1.5 transition-colors hover:bg-success/[0.075] focus-within:border-success/40', className)}>
      <button
        type="button"
        disabled={!onOpenFile}
        onClick={() => onOpenFile?.(item.src)}
        title={title}
        className="group/html flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/10">
          <FileTypeIcon fileName={item.src} className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">HTML · {fileName}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-success">
          {t('preview.openInBrowser')}
          <ArrowUpRight aria-hidden="true" className="size-4 transition-transform group-hover/html:translate-x-0.5 group-hover/html:-translate-y-0.5" />
        </span>
      </button>
      <ItemNavigator items={items} activeIndex={selectedIndex} onSelect={setActiveIndex} />
    </div>
  )
}
