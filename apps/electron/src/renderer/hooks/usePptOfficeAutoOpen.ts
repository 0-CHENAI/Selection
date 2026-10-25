import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { sessionAtomFamily } from '@/atoms/sessions'

type OfficeAutoOpen = {
  isOpen: boolean
  path: string
  pending: boolean
  open: (sessionId: string, path?: string, candidates?: string[], pickerInPanel?: boolean) => Promise<void>
  awaitDocument: (sessionId: string) => void
  subscribeDismiss: (listener: () => void) => () => void
}

/**
 * PPT generation opens the normal Office panel. Before a real pptx exists the
 * panel stays on its own loading state. Closing it stays closed until the next turn.
 */
export function usePptOfficeAutoOpen(sessionId: string | null | undefined, office: OfficeAutoOpen, officeFiles: string[]) {
  const activeId = sessionId || 'ppt-office-none'
  const session = useAtomValue(sessionAtomFamily(activeId))
  const active = sessionId && session?.id === sessionId ? session : null
  const dismissed = useRef(false)
  const wasProcessing = useRef(false)
  const followed = useRef<string | undefined>(undefined)
  const processing = !!active?.isProcessing
  const pptMode = !!active?.ppt
  const generating = pptMode && (processing || !!active?.pptProgress?.generating)
  const pptxPath = active?.pptProgress?.pptxPath
  const { isOpen, path, pending, open, awaitDocument, subscribeDismiss } = office

  useEffect(() => subscribeDismiss(() => { dismissed.current = true }), [subscribeDismiss])
  useEffect(() => {
    dismissed.current = false
    wasProcessing.current = false
    followed.current = undefined
  }, [sessionId])
  useEffect(() => {
    if (processing && !wasProcessing.current) {
      dismissed.current = false
      followed.current = undefined
    }
    wasProcessing.current = processing
  }, [processing])
  useEffect(() => {
    if (!sessionId || !pptMode || !generating || dismissed.current) return
    if (path && followed.current !== undefined && path !== followed.current && !pending) return
    if (!pptxPath) {
      followed.current = ''
      if (!isOpen) awaitDocument(sessionId)
      return
    }
    if (path === pptxPath) {
      followed.current = pptxPath
      return
    }
    followed.current = pptxPath
    const candidates = [...new Set([pptxPath, ...officeFiles])]
    void open(sessionId, pptxPath, candidates)
  }, [sessionId, pptMode, generating, pptxPath, isOpen, path, pending, open, awaitDocument, officeFiles])
}
