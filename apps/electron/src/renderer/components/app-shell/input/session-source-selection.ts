/** Optimistic selections belong to one composer, including unsaved drafts. */
export interface SessionSourceSelection {
  key: string | undefined
  confirmed: readonly string[]
  slugs: string[]
}

export function reconcileSessionSourceSelection(
  current: SessionSourceSelection | undefined,
  key: string | undefined,
  confirmed: string[],
): SessionSourceSelection {
  if (current && current.key === key && current.confirmed.length === confirmed.length
    && current.confirmed.every((slug, index) => slug === confirmed[index])) return current
  return { key, confirmed: [...confirmed], slugs: [...confirmed] }
}
