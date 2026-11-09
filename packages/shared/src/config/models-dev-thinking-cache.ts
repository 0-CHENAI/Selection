/**
 * Node-side models.dev cache. The renderer loads the same compact JSON
 * through localStorage and must not import this file (it touches the filesystem).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from './paths.ts'
import { ensureModelsDevThinkingIndex, type ModelsDevStorage } from './models-dev-thinking.ts'

function cacheFile(): string {
  return join(CONFIG_DIR, 'cache', 'models-dev-thinking.json')
}

function fileStorage(): ModelsDevStorage {
  return {
    read() {
      try {
        return readFileSync(cacheFile(), 'utf8')
      } catch {
        return null
      }
    },
    write(value: string) {
      const path = cacheFile()
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, value)
    },
  }
}

export function loadModelsDevThinkingCache(): Promise<void> {
  return ensureModelsDevThinkingIndex({ storage: fileStorage() })
}
