import * as React from 'react'
import katex from 'katex'
import { cn } from '../../lib/utils'

interface MarkdownLatexBlockProps {
  code: string
  className?: string
  /**
   * Display math for ```latex fences. Inline math (`$...$` falling through
   * the `code` renderer) must stay in the sentence.
   */
  displayMode?: boolean
}

/**
 * MarkdownLatexBlock - Renders fenced ```latex / ```math code blocks as display math.
 *
 * Uses KaTeX to render LaTeX source into styled HTML.
 * On parse errors, shows the raw source with an error message.
 */
export function MarkdownLatexBlock({ code, className, displayMode = true }: MarkdownLatexBlockProps) {
  const html = React.useMemo(() => {
    try {
      return katex.renderToString(code.trim(), {
        displayMode,
        throwOnError: false,
        strict: false,
      })
    } catch {
      return null
    }
  }, [code, displayMode])

  if (!html) {
    return (
      <pre className={cn('font-mono text-sm whitespace-pre-wrap text-destructive', className)}>
        <code>{code}</code>
      </pre>
    )
  }

  if (!displayMode) {
    return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
  }

  return (
    <div
      className={cn('overflow-x-auto py-2', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
