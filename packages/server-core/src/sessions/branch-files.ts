import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Keep the fork input and user artifacts inside the new session, never in its parent. */
export async function copyBranchFiles(sourceDir: string, branchDir: string): Promise<string> {
  if (resolve(sourceDir) === resolve(branchDir)) throw new Error('A branch must have its own directory')
  const snapshotDir = join(branchDir, '.branch-source')
  await mkdir(snapshotDir, { recursive: true })
  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    // Session headers, anchor indexes and earlier fork inputs belong to the source.
    if (['session.jsonl', 'session.jsonl.tmp', 'meta', '.branch-source'].includes(entry.name)) continue
    const destination = entry.name === '.pi-sessions' ? snapshotDir : branchDir
    await cp(join(sourceDir, entry.name), join(destination, entry.name), {
      recursive: true, dereference: true, force: false, errorOnExist: false,
    })
  }
  // SDK messages can reference attachments and generated files by absolute path.
  // Rewrite JSON string content, preserving entry IDs and the selected branch anchor.
  const sdkDir = join(snapshotDir, '.pi-sessions')
  let sdkFiles: string[]
  try { sdkFiles = await readdir(sdkDir) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return snapshotDir
    throw error
  }
  const sourcePath = JSON.stringify(sourceDir).slice(1, -1)
  const branchPath = JSON.stringify(branchDir).slice(1, -1)
  for (const file of sdkFiles.filter(name => name.endsWith('.jsonl'))) {
    const path = join(sdkDir, file)
    const content = await readFile(path, 'utf8')
    await writeFile(path, content.replaceAll(sourcePath, branchPath), 'utf8')
  }
  return snapshotDir
}
