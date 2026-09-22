/** Scope recovery to one route visit, so stale replies cannot redirect a new page. */
export function recoverMissingSession(
  load: () => Promise<unknown>,
  onMissing: () => void,
  onError: (error: unknown) => void,
): () => void {
  let cancelled = false
  void load().then(session => {
    if (!cancelled && session === null) onMissing()
  }).catch(error => {
    if (!cancelled) onError(error)
  })
  return () => { cancelled = true }
}
