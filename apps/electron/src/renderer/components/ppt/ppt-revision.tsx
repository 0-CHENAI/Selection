import { createContext, useContext } from 'react'
import type { PptRevision } from '@craft-agent/shared/protocol'

export type PptRevisionSend = (text: string, revision: PptRevision) => Promise<boolean>
export const PptRevisionContext = createContext<PptRevisionSend | null>(null)
export function usePptRevisionSend(): PptRevisionSend | null {
  return useContext(PptRevisionContext)
}
