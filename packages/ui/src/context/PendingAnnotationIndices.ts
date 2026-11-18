import { createContext } from 'react'

/** Composer numbering, scoped to a session and then to each source message. */
export const PendingAnnotationIndices = createContext<ReadonlyMap<string, ReadonlyMap<string, number>> | null>(null)
