import { rename } from 'node:fs/promises'

/** Windows readers and antivirus can briefly lock the committed transcript. */
export async function replaceSessionFile(
  temporaryPath: string,
  committedPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporaryPath, committedPath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= 5) throw error
      // Keep the original file readable throughout retries. Never unlink it.
      await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt))
    }
  }
}
