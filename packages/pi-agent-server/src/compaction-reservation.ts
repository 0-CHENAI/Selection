/** Shared reservation closes the window before SDK compact() sets isCompacting. */
const reservations = new WeakSet<object>()
export function hasCompactionReservation(session: object): boolean { return reservations.has(session) }
export function reserveCompaction(session: object): () => void {
  if (reservations.has(session)) throw new Error('A manual compaction request is already pending for this session.')
  reservations.add(session)
  let released = false
  return () => {
    if (released) return
    released = true
    reservations.delete(session)
  }
}
