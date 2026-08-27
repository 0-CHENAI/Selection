/**
 * Hand a path to the OS without tying the transport response to the lifetime
 * of the default application's launch request.
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
): Record<string, never> {
  const completion = openPath(path)

  void completion.then(
    error => {
      if (error) logError(`Failed to open file: ${error}`)
    },
    error => logError('Failed to open file:', error),
  )

  // The capability acknowledges that the request was dispatched. Synchronous
  // errors from openPath still propagate to the caller above.
  return {}
}
