import { useEffect, useRef, useState } from 'react'
import type { PptPageProgress } from '@craft-agent/shared/protocol'
import { slidePreviewPath } from './ppt-result-model'

/** Reload a page image only when its stamp changes, so each saved PNG updates that thumbnail. */
export function usePptSlideThumbs(sessionDir: string | undefined, pages: PptPageProgress[] | undefined): Record<number, string> {
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const signature = pages?.map(page => `${page.index}\n${page.imageName ?? ''}\n${page.imageStamp ?? ''}`).join('\n') ?? ''
  useEffect(() => {
    const listed = pagesRef.current
    const read = window.electronAPI?.readFilePreviewDataUrl
    if (!sessionDir || !listed?.length || !read) {
      setThumbs({})
      return
    }
    let cancelled = false
    void Promise.all(listed.map(async page => {
      if (!page.imageName) return [page.index, ''] as const
      const path = slidePreviewPath(sessionDir, page.imageName)
      if (!path) return [page.index, ''] as const
      try {
        const url = await read(path, 256)
        return [page.index, typeof url === 'string' ? url : ''] as const
      } catch {
        return [page.index, ''] as const
      }
    })).then(entries => {
      if (cancelled) return
      const next: Record<number, string> = {}
      for (const [index, url] of entries) if (url) next[index] = url
      setThumbs(next)
    })
    return () => { cancelled = true }
  }, [sessionDir, signature])
  return thumbs
}
