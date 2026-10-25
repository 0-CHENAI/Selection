import { useEffect, useState } from 'react'
import type { PptCatalog } from '@craft-agent/shared/protocol'
import { pptPreviewCache } from './preview-cache'

let catalogPromise: Promise<PptCatalog> | undefined

export function refreshPptCatalog() {
  catalogPromise = undefined
  pptPreviewCache.clear()
}
export function usePptPreview(templateId: string | undefined, page?: number) {
  const key = templateId ? `${templateId}:${page ?? 'pdf'}` : undefined
  const [result, setResult] = useState<{ key: string; data?: string; error?: boolean }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!templateId || !key) return
    let active = true
    pptPreviewCache.get(key, () => window.electronAPI.getPptTemplatePreview(templateId, page)).then(
      data => { if (active) setResult({ key, data }) },
      () => { if (active) setResult({ key, error: true }) },
    )
    return () => { active = false }
  }, [templateId, page, key, attempt])
  return { data: result?.key === key ? result?.data : undefined, error: result?.key === key && result?.error,
    retry: () => { setResult(undefined); setAttempt(value => value + 1) } }
}

export function usePptCatalog(revision = 0) {
  const [catalog, setCatalog] = useState<PptCatalog>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    catalogPromise ??= window.electronAPI.getPptCatalog().catch(reason => { catalogPromise = undefined; throw reason })
    catalogPromise.then(value => { if (active) { setCatalog(value); setError(false) } }, () => { if (active) setError(true) })
    return () => { active = false }
  }, [attempt, revision])
  return { catalog, error, retry: () => { catalogPromise = undefined; setError(false); setAttempt(value => value + 1) } }
}
