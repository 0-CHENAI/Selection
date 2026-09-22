import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { usePlatform } from '../../context/PlatformContext'
import { resolveMarkdownImageSource } from './markdown-image-source'

export interface MarkdownImageProps {
  src?: string
  alt?: string
  onFileClick?: (path: string) => void
}

export function MarkdownImage({ src, alt, onFileClick }: MarkdownImageProps) {
  const { t } = useTranslation()
  const { onReadFileDataUrl } = usePlatform()
  const source = React.useMemo(() => resolveMarkdownImageSource(src), [src])
  const [displaySrc, setDisplaySrc] = React.useState<string | null>(
    () => (source.kind === 'remote' || source.kind === 'data' ? source.src : null),
  )
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>(() => {
    if (source.kind === 'remote' || source.kind === 'data') return 'ready'
    if (source.kind === 'file') return 'loading'
    return 'error'
  })

  React.useEffect(() => {
    if (source.kind === 'remote' || source.kind === 'data') {
      setDisplaySrc(source.src)
      setStatus('ready')
      return
    }

    if (source.kind !== 'file' || !onReadFileDataUrl) {
      setDisplaySrc(null)
      setStatus('error')
      return
    }

    let cancelled = false
    setDisplaySrc(null)
    setStatus('loading')
    onReadFileDataUrl(source.path)
      .then((url) => {
        if (cancelled) return
        setDisplaySrc(url)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setDisplaySrc(null)
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [onReadFileDataUrl, source])

  if (status === 'loading') {
    return (
      <div className="my-2 py-6 text-center text-[13px] text-muted-foreground">
        {t('preview.loadingImage')}
      </div>
    )
  }

  if (status === 'error' || !displaySrc) {
    return (
      <div
        role="status"
        className="my-2 rounded-[8px] bg-foreground-2 px-3 py-6 text-center text-[13px] text-destructive/70"
      >
        {t('chat.imageLoadFailed')}
      </div>
    )
  }

  const filePath = source.kind === 'file' ? source.path : null
  const clickable = Boolean(filePath && onFileClick)

  return (
    <img
      src={displaySrc}
      alt={alt || ''}
      draggable={false}
      className={cn('block mx-auto my-2 max-h-[480px] max-w-full rounded-[8px] object-contain', clickable && 'cursor-pointer')}
      onError={() => setStatus('error')}
      onClick={clickable && filePath && onFileClick ? () => onFileClick(filePath) : undefined}
    />
  )
}
