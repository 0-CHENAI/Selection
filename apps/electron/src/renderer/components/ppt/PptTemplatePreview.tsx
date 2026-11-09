import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { PptTemplate } from '@craft-agent/shared/protocol'
import { usePptPreview } from './usePptCatalog'

const PdfPages = React.lazy(() => import('./PptTemplatePdfPages'))

export function PreviewError({ retry }: { retry: () => void }) {
  const { t } = useTranslation()
  return <p role="alert" className="py-8 text-center text-sm">{t('ppt.loadError')} <button type="button" onClick={retry} className="underline">{t('ppt.retry')}</button></p>
}

/** Reserve each page's real geometry while keeping distant canvases/images unmounted. */
export function PreviewPage({ title, number, count, ratio, children }: { title: string; number: number; count: number; ratio: number; children: (width: number, dpr: number) => React.ReactNode }) {
  const ref = React.useRef<HTMLElement>(null)
  const [visible, setVisible] = React.useState(false)
  const [size, setSize] = React.useState({ width: 0, height: 0, dpr: 1 })
  React.useEffect(() => {
    const node = ref.current!
    const update = () => setSize({ width: node.clientWidth, height: window.innerHeight * 0.7, dpr: window.devicePixelRatio || 1 })
    update()
    const resize = new ResizeObserver(update)
    resize.observe(node)
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { root: node.closest('[data-ppt-preview-scroll]'), rootMargin: '400px 0px' })
    observer.observe(node)
    // Resolution can change without a CSS resize when moving an Electron window between screens.
    let media: MediaQueryList
    const resolution = () => {
      media?.removeEventListener('change', resolution)
      update()
      media = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      media.addEventListener('change', resolution)
    }
    resolution()
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); resize.disconnect(); media.removeEventListener('change', resolution); window.removeEventListener('resize', update) }
  }, [])
  const width = Math.max(1, Math.floor(Math.min(size.width, size.height * ratio)))
  const height = width / ratio
  // Bound exceptional displays while preserving 2x/3x Retina at the dialog's maximum size.
  const dpr = Math.min(size.dpr, Math.sqrt(8_000_000 / (width * height)))
  return <figure ref={ref} className="w-full" aria-label={`${title} — ${number}`}>
    <div className="flex w-full justify-center overflow-hidden rounded border border-border/50 bg-white" style={{ height: size.width ? height : undefined, aspectRatio: size.width ? undefined : ratio }}>
      {visible && size.width > 0 ? children(width, dpr) : null}
    </div>
    <figcaption className="mt-1 text-center text-xs text-muted-foreground">{number} / {count}</figcaption>
  </figure>
}

function CustomPage({ template, page }: { template: PptTemplate; page: number }) {
  const preview = usePptPreview(template.id, page)
  const { t } = useTranslation()
  const html = React.useMemo(() => preview.data?.startsWith('data:text/html;base64,') ? new TextDecoder().decode(Uint8Array.from(atob(preview.data.split(',')[1]!), char => char.charCodeAt(0))) : undefined, [preview.data])
  return preview.error ? <PreviewError retry={preview.retry} /> : html ? <iframe title={`${template.title} — ${page}`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={html} className="h-full w-full border-0" /> : preview.data ? <img src={preview.data} alt={`${template.title} — ${page}`} decoding="async" className="h-full max-w-full object-contain" /> : <p role="status" className="py-8 text-sm text-muted-foreground">{t('ppt.loading')}</p>
}

export function PptTemplatePreview({ template }: { template: PptTemplate }) {
  const { t } = useTranslation()
  const custom = template.category === '自定义'
  const preview = usePptPreview(custom ? undefined : template.id)
  if (custom) {
    const dimensions = template.canvas.split(/[:×]/).map(Number)
    const ratio = dimensions[0]! / dimensions[1]! || 16 / 9
    return <>{Array.from({ length: template.pages }, (_, index) => <PreviewPage key={index} title={template.title} number={index + 1} count={template.pages} ratio={ratio}>{() => <CustomPage template={template} page={index + 1} />}</PreviewPage>)}</>
  }
  if (preview.error) return <PreviewError retry={preview.retry} />
  const loading = <p role="status" className="py-8 text-center text-sm text-muted-foreground">{t('ppt.loading')}</p>
  return preview.data ? <React.Suspense fallback={loading}><PdfPages key={template.id} template={template} data={preview.data} /></React.Suspense> : loading
}
