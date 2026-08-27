/**
 * Hand a path to the OS without tying the transport response indefinitely to
 * the lifetime of the default application's launch request.
 *
 * On some Windows 10 systems Electron's shell.openPath() promise can remain
 * pending while Windows negotiates a file association (notably for Office
 * documents). Awaiting it indefinitely keeps both sides of the nested RPC open
 * until the renderer reports a misleading shell:openFile timeout. A short
 * grace period preserves actionable errors that Electron returns promptly.
 */
export const OPEN_PATH_RESULT_GRACE_MS = 1_000

export interface OpenPathResult {
  error?: string
}

export interface DispatchOpenPathOptions {
  graceMs?: number
  logError?: (message: string, error?: unknown) => void
}

export function dispatchOpenPath(
  path: string,
  openPath: (path: string) => Promise<string>,
  options: DispatchOpenPathOptions = {},
): Promise<OpenPathResult> {
  const {
    graceMs = OPEN_PATH_RESULT_GRACE_MS,
    logError = console.error,
  } = options
  const completion = openPath(path)

  return new Promise((resolve, reject) => {
    let acknowledged = false
    const timeout = setTimeout(() => {
      acknowledged = true
      resolve({})
    }, Math.max(0, graceMs))

    void completion.then(
      error => {
        if (acknowledged) {
          if (error) logError(`Failed to open file: ${error}`)
          return
        }

        clearTimeout(timeout)
        resolve({ error: error || undefined })
      },
      error => {
        if (acknowledged) {
          logError('Failed to open file:', error)
          return
        }

        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
