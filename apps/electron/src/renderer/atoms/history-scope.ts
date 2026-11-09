import { atom } from 'jotai'

/**
 * Sidebar project scope mirrored into navigation history.
 *
 * The string form matches `serializeProjectHistoryScope`. History restore
 * writes the atom and bumps `historyScopeRevisionAtom` so the shell can apply
 * it without treating every local filter edit as a restore.
 */
export const historyScopeAtom = atom('')

/** Incremented only when back/forward restores a scope, not when the user edits it. */
export const historyScopeRevisionAtom = atom(0)

/**
 * The next scope write refreshes the current history entry instead of pushing.
 * Saved project filters hydrate after the first paint; that alignment is not a
 * page the user visited.
 */
export const historyScopeSilentAtom = atom(false)
