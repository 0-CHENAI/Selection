import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ThoughtMaterial } from '@craft-agent/shared/thought-workbench/types'
import { workbenchPdf } from './workbench-material-file'
import { pdfRasterScale } from './workbench-pdf-scale'
import type { PDFDocumentProxy } from 'pdfjs-dist'

function PdfPage({ bytes, page, zoom }: { bytes: Uint8Array; page: number; zoom: number }) {
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const [error, setError] = React.useState('')
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null)
  React.useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    setDocument(null); setError('')
    void (async () => {
      const pdf = await workbenchPdf()
      if (cancelled) return
      const task = pdf.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true })
      dispose = () => { void task.destroy().catch(() => {}) }
      const loaded = await task.promise
      if (!cancelled) setDocument(loaded)
    })().catch(error => { if (!cancelled) setError(String(error)) })
    return () => { cancelled = true; dispose?.() }
  }, [bytes])
  React.useEffect(() => {
    if (!document) return
    let cancelled = false
    let cancelRender: (() => void) | undefined
    setError('')
    void (async () => {
      const selected = await document.getPage(page)
      try {
        if (cancelled || !canvas.current) return
        const dimensions = selected.getViewport({ scale: 1 })
        const viewport = selected.getViewport({ scale: pdfRasterScale(dimensions.width, dimensions.height, 1.25 * zoom) })
        canvas.current.width = viewport.width; canvas.current.height = viewport.height
        const rendering = selected.render({ canvas: canvas.current, viewport })
        cancelRender = () => rendering.cancel()
        await rendering.promise
      } finally { selected.cleanup() }
    })().catch(error => { if (!cancelled) setError(String(error)) })
    return () => { cancelled = true; cancelRender?.() }
  }, [document, page, zoom])
  return <>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<canvas ref={canvas} className="h-auto w-full" /></>
}

export function WorkbenchMaterialReader({ workspaceId, documentId, material, disabled, onQuote }: {
  workspaceId: string; documentId: string; material: ThoughtMaterial; disabled?: boolean;
  onQuote: (selection: { materialId: string; page?: number; start: number; end: number }) => Promise<void>;
}) {
  const { t } = useTranslation()
  const firstPage = material.page ?? material.pages?.[0]?.page ?? (material.mimeType === 'application/pdf' ? 1 : undefined)
  const [page, setPage] = React.useState(firstPage)
  const [bytes, setBytes] = React.useState<Uint8Array | null>(null)
  const [url, setUrl] = React.useState('')
  const [error, setError] = React.useState('')
  const [selection, setSelection] = React.useState({ start: 0, end: 0 })
  const [busy, setBusy] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  React.useEffect(() => {
    let active = true, resource = ''
    setBytes(null); setUrl(''); setError(''); setSelection({ start: 0, end: 0 }); setPage(firstPage); setZoom(1)
    void window.electronAPI.thoughtWorkbench(workspaceId, { action: 'readMaterial', id: documentId, materialId: material.id }).then(result => {
      if (!active || result.base64 === undefined) return
      const data = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
      resource = URL.createObjectURL(new Blob([data], { type: material.mimeType }))
      setBytes(data); setUrl(resource)
    }).catch(error => { if (active) setError(String(error)) })
    return () => { active = false; if (resource) URL.revokeObjectURL(resource) }
    // Page arrays are reconstructed by context compilation; they do not identify
    // a new original file. Avoid re-decoding the same PDF on every graph update.
  }, [workspaceId, documentId, material.id, material.digest, material.mimeType, firstPage])
  const text = !material.pages?.length ? material.text : material.pages.find(item => item.page === page)?.text ?? ''
  return <section className="space-y-2 border-t pt-3">
    <div className="flex flex-wrap items-center gap-2"><h3 className="min-w-0 flex-1 truncate text-sm font-medium">{material.name}</h3>
      {url && <a href={url} download={material.name} className="text-sm underline underline-offset-4">{t('thought.original')}</a>}
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {material.pages?.length ? <select aria-label={t('thought.page')} className="rounded border bg-background p-2 text-sm" value={page} onChange={event => { setPage(Number(event.target.value)); setSelection({ start: 0, end: 0 }) }}>{material.pages.map(item => <option key={item.page} value={item.page}>{t('thought.pageNumber', { page: item.page })}</option>)}</select> : null}
    {url && (material.mimeType === 'application/pdf' || material.mimeType.startsWith('image/')) && <>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" aria-label={t('menu.zoomOut')} disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}>−</Button>
        <Button variant="ghost" size="sm" aria-label={t('menu.resetZoom')} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
        <Button variant="ghost" size="sm" aria-label={t('menu.zoomIn')} disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.5))}>+</Button>
      </div>
      <div className="max-h-96 overflow-auto rounded border border-border" tabIndex={0} aria-label={material.name}>
        <div style={{ width: `${zoom * 100}%` }}>
          {bytes && material.mimeType === 'application/pdf' && page && <PdfPage bytes={bytes} page={page} zoom={zoom} />}
          {material.mimeType.startsWith('image/') && <img src={url} alt={material.name} className="h-auto w-full" />}
        </div>
      </div>
    </>}
    <textarea readOnly aria-label={t('thought.materialText')} className="min-h-40 w-full rounded border border-border bg-background p-2 text-sm leading-relaxed" value={text}
      onSelect={event => setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} />
    {!text && <p className="text-xs text-muted-foreground">{t('thought.noTextLayer')}</p>}
    <Button variant="outline" disabled={disabled || busy || !!material.selection || selection.end <= selection.start} onClick={async () => {
      setBusy(true)
      try { await onQuote({ materialId: material.id, page, ...selection }) } catch (error) { setError(String(error)) } finally { setBusy(false) }
    }}>{t('thought.quoteSelection')}</Button>
    {material.selection && <p className="break-all text-xs text-muted-foreground">{material.selection.materialId} · {material.selection.start}–{material.selection.end}</p>}
  </section>
}
