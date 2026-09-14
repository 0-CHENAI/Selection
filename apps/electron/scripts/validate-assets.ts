import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Verify copied runtime text assets against their authoritative source, not just
 * the existence of an old incremental-build directory. */
export function validateCopiedAssets(source: string, destination: string): string[] {
  const errors: string[] = []
  const queue = ['']
  for (let index = 0; index < queue.length; index++) {
    const relative = queue[index]!
    const input = join(source, relative), output = join(destination, relative)
    if (!existsSync(input)) { errors.push(`Missing source: ${input}`); continue }
    const stat = lstatSync(input)
    if (stat.isSymbolicLink()) { errors.push(`Unexpected source symlink: ${input}`); continue }
    if (stat.isDirectory()) {
      if (!existsSync(output) || !lstatSync(output).isDirectory() || lstatSync(output).isSymbolicLink()) {
        errors.push(`Missing or invalid copied directory: ${output}`); continue
      }
      queue.push(...readdirSync(input).map(name => join(relative, name)))
      continue
    }
    if (!existsSync(output) || !lstatSync(output).isFile() || lstatSync(output).isSymbolicLink()) {
      errors.push(`Missing or invalid copied asset: ${output}`); continue
    }
    const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
    if (digest(input) !== digest(output)) errors.push(`Stale copied asset: ${output}`)
  }
  return errors
}

export function validateBuildAssets(electronRoot: string): string[] {
  const errors: string[] = []
  for (const file of ['main.cjs', 'bootstrap-preload.cjs', 'browser-toolbar-preload.cjs', 'interceptor.cjs', 'renderer/index.html']) {
    const path = join(electronRoot, 'dist', file)
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).size === 0) errors.push(`Missing build output: ${path}`)
  }
  for (const asset of ['docs', 'themes', 'permissions', 'tool-icons', 'skills', 'config-defaults.json']) {
    errors.push(...validateCopiedAssets(join(electronRoot, 'resources', asset), join(electronRoot, 'dist/resources', asset)))
  }
  return errors
}

if (import.meta.main) {
  const errors = validateBuildAssets(resolve(import.meta.dir, '..'))
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
  else console.log('✓ Build outputs and copied runtime assets verified')
}
