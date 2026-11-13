import type { BrowserWindow } from 'electron'

/** Reload only the UI; the server and its running sessions stay alive. */
export function installRendererRecovery(
  window: BrowserWindow,
  quitting: () => boolean,
  report: (reason: string) => void,
  exhausted: () => void,
) {
  let attempts: number[] = []
  const gone = (_event: unknown, details: { reason: string }) => {
    if (quitting() || window.isDestroyed() || window.webContents.isDestroyed() || details.reason === 'clean-exit') return
    report(details.reason)
    const now = Date.now()
    attempts = attempts.filter(time => now - time < 60_000)
    if (attempts.length >= 2) {
      exhausted()
      return
    }
    attempts.push(now)
    window.webContents.reload()
  }
  window.webContents.on('render-process-gone', gone)
  window.once('closed', () => window.webContents.removeListener('render-process-gone', gone))
}
