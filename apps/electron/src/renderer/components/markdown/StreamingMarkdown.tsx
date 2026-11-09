import * as React from 'react'
import { Markdown, type RenderMode } from '@craft-agent/ui'

interface StreamingMarkdownProps {
  content: string
  id?: string
  revealStartTime?: number
  isStreaming: boolean
  mode?: RenderMode
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
}

/** Parse one complete document, retaining reference definitions and footnotes.
 * The shared renderer animates semantic DOM units without changing their keys
 * or replacing the tree when streaming completes.
 */
export function StreamingMarkdown({
  content,
  id,
  revealStartTime,
  isStreaming,
  mode = 'minimal',
  onUrlClick,
  onFileClick,
}: StreamingMarkdownProps) {
  return (
    <Markdown id={id} revealStartTime={revealStartTime} mode={mode} isStreaming={isStreaming} onUrlClick={onUrlClick} onFileClick={onFileClick}>
      {content}
    </Markdown>
  )
}
