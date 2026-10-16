/**
 * Timestamped stream probes. Off unless CRAFT_STREAM_TRACE=1.
 * Counts and event names only — never request bodies, prompts, or model text.
 */
export function streamTrace(layer: string, fields: Record<string, number | string> = {}): void {
  if (typeof process === 'undefined' || process.env.CRAFT_STREAM_TRACE !== '1') return
  const line = `@@STREAM@@${JSON.stringify({ t: Date.now(), layer, ...fields })}\n`
  try {
    if (process.stderr?.write) process.stderr.write(line)
    else console.debug(line.trim())
  } catch {
    // Diagnostics must not interrupt model output.
  }
}
