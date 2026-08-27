/**
 * Hand a path to the OS without tying the transport response to the full
 * lifetime of the default application's launch request. A short grace window
 * preserves actionable association/dispatch errors that resolve promptly.
 *
 * On some Windows 10 systems Electron's shell.openPath() promise can remain
 * pending while Windows negotiates a file association (notably for Office
 * documents). Awaiting it keeps both sides of the nested RPC open until the
 * renderer reports a misleading shell:openFile timeout.
 */
export function dispatchOpenPath(
  path: string,
  openPath: (path: string) => Promise<string>,
  logError: (message: string, error?: unknown) => void = console.error,
  errorGraceMs = 250,
): Promise<{ error?: string }> {
  const completion = openPath(path)

  return new Promise(resolve => {
    let acknowledged = false
    const finish = (result: { error?: string }) => {
      if (acknowledged) return false
      acknowledged = true
      clearTimeout(timer)
      resolve(result)
      return true
    }
    const timer = setTimeout(() => finish({}), errorGraceMs)

    void completion.then(
      error => {
        if (!finish(error ? { error } : {}) && error) {
          logError(`Failed to open file: ${error}`)
        }
      },
      error => {
        const message = error instanceof Error ? error.message : String(error)
        if (!finish({ error: message })) logError('Failed to open file:', error)
      },
    )
  })
}
