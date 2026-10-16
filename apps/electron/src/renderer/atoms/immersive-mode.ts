import { atom } from 'jotai'

/** Preference. Layout is applied only on a conversation surface. */
export const immersiveModeEnabledAtom = atom(false)

/** True only when the preference is on and the current page can collapse to the conversation. */
export const immersiveLayoutActiveAtom = atom(false)
