import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'

export const skipHandoverConfirmationAtom = atomWithStorage<boolean>(
  'craft-skip-handover-confirmation', false, undefined, { getOnInit: true }
)

// Transient feedback belongs to the new chat, never to persisted session metadata.
export const handoverSuccessAtom = atom<{ sessionId: string; mode: WorkMode; expiresAt: number } | null>(null)
export const handoverReviewSessionAtom = atom<string | null>(null)
