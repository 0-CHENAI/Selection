import { useEffect, useState } from 'react'
import type { LivePickerModel } from '@/components/app-shell/input/model-picker-helpers'

const CACHE_TTL_MS = 5 * 60 * 1000

let cached: { models: LivePickerModel[]; fetchedAt: number } | null = null
let inflight: Promise<LivePickerModel[]> | null = null

function loadLiveOpenRouterModels(): Promise<LivePickerModel[]> {
  if (cached && Date.now() - cached.fetchedAt <= CACHE_TTL_MS) {
    return Promise.resolve(cached.models)
  }
  if (inflight) return inflight

  const fetchModels = window.electronAPI?.getPiProviderModels
  if (!fetchModels) return Promise.resolve([])

  inflight = fetchModels('openrouter')
    .then((result) => {
      cached = { models: result.models, fetchedAt: Date.now() }
      return result.models
    })
    .catch(() => {
      cached = { models: [], fetchedAt: Date.now() }
      return []
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

/**
 * Live OpenRouter catalog for Settings and chat pickers.
 * Falls back to [] (caller uses the stored / SDK snapshot) when the fetch fails.
 */
export function useLiveOpenRouterModels(enabled: boolean): LivePickerModel[] | null {
  const [models, setModels] = useState<LivePickerModel[] | null>(() => {
    if (!enabled || !cached) return null
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null
    return cached.models
  })

  useEffect(() => {
    if (!enabled) {
      setModels(null)
      return
    }

    let cancelled = false
    loadLiveOpenRouterModels().then((next) => {
      if (!cancelled) setModels(next)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return models
}
