import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export const skipHandoverConfirmationAtom = atomWithStorage<boolean>(
  'craft-skip-handover-confirmation', false, undefined, { getOnInit: true }
)

export const handoverReviewSessionAtom = atom<string | null>(null)
