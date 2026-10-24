import { useEffect, useState } from 'react'
import type { PptCatalog } from '@craft-agent/shared/protocol'
let catalogPromise: Promise<PptCatalog> | undefined
export function usePptCatalog() {
  const [catalog, setCatalog] = useState<PptCatalog>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    catalogPromise ??= window.electronAPI.getPptCatalog().catch(error => { catalogPromise = undefined; throw error })
    catalogPromise.then(value => { if (active) { setCatalog(value); setError(false) } }, () => { if (active) setError(true) })
    return () => { active = false }
  }, [attempt])
  return { catalog, error, retry: () => { setError(false); setAttempt(value => value + 1) } }
}

const pagesCache = new Map<string, Promise<string[]>>()
export function usePptTemplatePages(templateId: string | undefined) {
  const [result, setResult] = useState<{ id: string; pages?: string[]; error?: boolean }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!templateId) return
    let active = true
    let promise = pagesCache.get(templateId)
    if (!promise) {
      promise = window.electronAPI.getPptTemplatePages(templateId).catch(error => { pagesCache.delete(templateId); throw error })
      pagesCache.set(templateId, promise)
    }
    promise.then(pages => { if (active) setResult({ id: templateId, pages }) }, () => { if (active) setResult({ id: templateId, error: true }) })
    return () => { active = false }
  }, [templateId, attempt])
  return {
    pages: result && result.id === templateId ? result.pages : undefined,
    error: result && result.id === templateId && result.error,
    retry: () => { setResult(undefined); setAttempt(value => value + 1) },
  }
}
