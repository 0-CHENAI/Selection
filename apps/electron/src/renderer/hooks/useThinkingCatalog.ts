import { useSyncExternalStore } from 'react'
import {
  getThinkingCatalogVersion,
  subscribeThinkingCatalog,
} from '@craft-agent/shared/agent/thinking-levels'

/** Re-render when a models.dev refresh or a learned effort probe changes the slider. */
export function useThinkingCatalog(): number {
  return useSyncExternalStore(subscribeThinkingCatalog, getThinkingCatalogVersion, getThinkingCatalogVersion)
}
