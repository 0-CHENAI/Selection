import * as React from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PptTemplate } from '@craft-agent/shared/protocol'
import { PreviewError, PreviewPage } from './PptTemplatePreview'

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker

export default function PptTemplatePdfPages({ template, data }: { template: PptTemplate; data: string }) {
  const [ratio, setRatio] = React.useState(16 / 9)
  const [error, setError] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const generation = React.useRef(0)
  React.useEffect(() => {
    const current = ++generation.current
    return () => { generation.current = current + 1 }
  }, [data, attempt])
  // PDF.js transfers this buffer to its worker; never transfer a cached shared buffer.
  const file = React.useMemo(() => ({ data: Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), char => char.charCodeAt(0)) }), [data])
  if (error) return <PreviewError retry={() => { setError(false); setAttempt(value => value + 1) }} />
  return <Document key={attempt} file={attempt ? data : file} className="!block w-full space-y-4" loading={null} onLoadError={() => setError(true)} onLoadSuccess={async pdf => {
    const current = generation.current
    try {
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 1 })
      if (current === generation.current) setRatio(viewport.width / viewport.height)
    } catch {
      // Destroying the worker on close/retry rejects pending page queries.
      if (current === generation.current) setError(true)
    }
  }}>
    {Array.from({ length: template.pages }, (_, index) => <PreviewPage key={index} title={template.title} number={index + 1} count={template.pages} ratio={ratio}>{(width, dpr) => <Page className="!mb-0 !shadow-none" pageNumber={index + 1} width={width} devicePixelRatio={dpr} renderTextLayer={false} renderAnnotationLayer={false} loading={null} onRenderError={() => setError(true)} />}</PreviewPage>)}
  </Document>
}
