/** One persistent session per draft, with synchronous duplicate-submit protection. */
export function createDraftSubmission<T>(create: () => Promise<T>) {
  let session: T | undefined
  let busy = false
  return async (send: (session: T) => void | Promise<void>): Promise<boolean> => {
    if (busy) return false
    busy = true
    try {
      session ??= await create()
      await send(session)
      return true
    } finally {
      busy = false
    }
  }
}
