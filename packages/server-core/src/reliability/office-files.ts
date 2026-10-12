import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { inside } from './isolated-workspace'

const excludedDirectories = new Set(['node_modules', 'dist', 'build', 'vendor', '__pycache__'])
const isOfficeFile = (path: string) => /\.(docx|xlsx|pptx)$/i.test(path) && !basename(path).startsWith('~$')

/** Find editable files on the session host, without traversing symlink directories or private drafts. */
export async function discoverOfficeFiles(roots: string[], excludedPaths: string[], referencedPaths: string[],
  authorize: (path: string) => Promise<string>): Promise<string[]> {
  const blocked = await Promise.all(excludedPaths.map(path => realpath(path).catch(() => resolve(path))))
  const queue = [...new Set(await Promise.all(roots.map(path => realpath(path).catch(() => resolve(path)))))]
  const visited = new Set<string>(), files = new Set<string>()
  const isBlocked = (path: string) => blocked.some(root => inside(root, path))
  const add = async (path: string) => {
    if (!isOfficeFile(path)) return
    try {
      const safe = await authorize(path)
      if (!isBlocked(safe) && (await stat(safe)).isFile()) files.add(safe)
    } catch { /* Removed, unreadable or out-of-scope files are not candidates. */ }
  }
  for (const path of referencedPaths) await add(path)
  let examined = 0
  // Bound background discovery in large project folders; breadth-first visits user files first.
  while (queue.length && examined < 10_000 && files.size < 500) {
    const directory = queue.shift()!
    if (visited.has(directory) || isBlocked(directory)) continue
    visited.add(directory)
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (++examined > 10_000 || files.size >= 500) break
      if (entry.name.startsWith('.')) continue
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name) && !isBlocked(path)) queue.push(path)
      } else if (entry.isFile() || entry.isSymbolicLink()) await add(path)
    }
  }
  return [...files].sort((a, b) => a.localeCompare(b))
}
