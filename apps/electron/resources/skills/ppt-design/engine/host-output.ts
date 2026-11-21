import { readFileSync, statSync, watch } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

export function deckFileStamp(file: string): string {
  const stat = statSync(file)
  return `${stat.mtimeMs}:${stat.size}`
}

export async function waitForHostOutput(file: string, stamp: string, timeoutMs = 10_000): Promise<string> {
  const sessionDir = process.env.CRAFT_SESSION_DIR
  const dir = sessionDir ? join(sessionDir, 'data') : dirname(file)
  const receipt = join(dir, 'ppt-output.json')
  return new Promise((resolve, reject) => {
    const watcher = watch(dir, check)
    const timer = setTimeout(() => finish(undefined, new Error('Selection did not export this saved deck. Check the host export status; do not use an earlier PPTX.')), timeoutMs)
    watcher.on('error', error => finish(undefined, error))
    check()

    function finish(path?: string, error?: Error) {
      clearTimeout(timer)
      watcher.close()
      if (path) resolve(path)
      else reject(error)
    }

    function check() {
      try {
        if (deckFileStamp(file) !== stamp) {
          finish(undefined, new Error('deck.json changed during export. Check the latest saved deck.'))
          return
        }
        const record = JSON.parse(readFileSync(receipt, 'utf8'))
        const path = record.path
        if (record.stamp === stamp && record.ready === true && typeof path === 'string'
          && isAbsolute(path) && /\.pptx$/i.test(path)) {
          const stat = statSync(path)
          if (stat.isFile() && stat.size > 0) finish(path)
        }
      } catch { /* The receipt or deliverable may not exist yet. */ }
    }
  })
}
