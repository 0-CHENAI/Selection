import { useEffect, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { PptLiveSnapshot, PptProgress } from '@craft-agent/shared/protocol'
import { sessionAtomFamily, updateSessionAtom, updateSessionMetaAtom } from '@/atoms/sessions'
import { PptLivePanel } from '@/components/ppt/PptLivePanel'
import { setPptSelection } from '@/components/ppt/ppt-selection'

function mergeSnapshot(previous: PptLiveSnapshot | null, next: PptLiveSnapshot): PptLiveSnapshot {
  if (!previous) return next
  return {
    ...next,
    pages: next.pages.map(page => {
      if (page.image) return page
      const old = previous.pages.find(item => item.index === page.index)
      if (old?.image && old.imageHash && old.imageHash === page.imageHash) return { ...page, image: old.image }
      return page
    }),
  }
}

function progressOf(snapshot: PptLiveSnapshot): PptProgress {
  return {
    fileName: snapshot.fileName,
    total: snapshot.total,
    completed: snapshot.completed,
    current: snapshot.current,
    currentTitle: snapshot.currentTitle,
    generating: snapshot.generating,
  }
}

export function usePptLive(sessionId: string | null | undefined, officeOpen: boolean, closeOffice: () => void) {
  const activeId = sessionId || 'ppt-live-none'
  const session = useAtomValue(sessionAtomFamily(activeId))
  const active = sessionId && session?.id === sessionId ? session : null
  const updateSession = useSetAtom(updateSessionAtom)
  const updateMeta = useSetAtom(updateSessionMetaAtom)
  const [snapshot, setSnapshot] = useState<PptLiveSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [fileIndex, setFileIndex] = useState(0)
  const known = useRef<Record<string, string>>({})
  const progressKey = useRef('')
  const wasProcessing = useRef(false)
  const processing = !!active?.isProcessing

  useEffect(() => {
    setSnapshot(null)
    setOpen(false)
    setDismissed(false)
    setFileIndex(0)
    known.current = {}
    progressKey.current = ''
    if (sessionId) setPptSelection(sessionId, [])
  }, [sessionId])

  useEffect(() => {
    if (processing && !wasProcessing.current) setDismissed(false)
    wasProcessing.current = processing
  }, [processing])

  const interested = !!sessionId && (!!active?.ppt || !!active?.pptProgress || processing || open)
  const generating = processing || !!snapshot?.generating
  useEffect(() => {
    if (!sessionId || !interested) return
    let stop = false
    const tick = async () => {
      try {
        const next = await window.electronAPI.getPptLive(sessionId, known.current)
        if (stop || !next) return
        setSnapshot(previous => mergeSnapshot(previous, next))
        const hashes: Record<string, string> = {}
        for (const page of next.pages) if (page.imageHash) hashes[String(page.index)] = page.imageHash
        known.current = hashes
        const progress = progressOf(next)
        const encoded = JSON.stringify(progress)
        if (encoded !== progressKey.current) {
          progressKey.current = encoded
          updateMeta(sessionId, { pptProgress: progress })
          updateSession(sessionId, previous => previous && JSON.stringify(previous.pptProgress) !== encoded ? { ...previous, pptProgress: progress } : previous)
        }
      } catch { /* keep the last good snapshot while a write is partial */ }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), generating ? 800 : 2000)
    return () => { stop = true; window.clearInterval(timer) }
  }, [sessionId, interested, generating, updateMeta, updateSession])

  const hasDeck = (snapshot?.pages.length ?? 0) > 0
  useEffect(() => {
    if (!sessionId || dismissed) return
    if (!hasDeck && !(generating && active?.ppt)) return
    setOpen(true)
    if (officeOpen) closeOffice()
  }, [sessionId, dismissed, hasDeck, generating, active?.ppt, officeOpen, closeOffice])

  const panel = open ? <PptLivePanel sessionId={sessionId ?? ''} snapshot={snapshot} busy={processing} fileIndex={fileIndex} onFileIndex={setFileIndex} onClose={() => { setDismissed(true); setOpen(false) }} /> : null
  return { panel, present: open }
}
