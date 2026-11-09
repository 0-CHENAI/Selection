const flights = new Map<string, { source: DOMRect; queuedAt: number }>()
const FLIGHT_EXPIRY_MS = 2000

export function queueTemplateFlight(key: string, source?: DOMRect) {
  if (source) {
    const now = Date.now()
    // Entries whose destination never mounted should not accumulate forever.
    for (const [id, flight] of flights) if (now - flight.queuedAt >= FLIGHT_EXPIRY_MS) flights.delete(id)
    flights.set(key, { source, queuedAt: now })
  } else flights.delete(key)
}

export function consumeTemplateFlight(key: string) {
  const flight = flights.get(key)
  flights.delete(key)
  return flight && Date.now() - flight.queuedAt < FLIGHT_EXPIRY_MS ? flight.source : undefined
}
