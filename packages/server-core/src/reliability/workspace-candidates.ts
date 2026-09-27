import { createHash } from 'node:crypto'
import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { inside, type IsolatedWorkspace } from './isolated-workspace'
import type { CandidateFile } from './integrate-candidates'

function readRegular(root: string, path: string): Buffer | null {
  const target = resolve(root,path)
  if (!inside(root,target) || root === target) throw new Error('Candidate path escapes the work directory')
  if (!existsSync(target)) return null
  if (!lstatSync(target).isFile() || !inside(realpathSync(root),realpathSync(target))) throw new Error('Candidate must be a regular file inside the work directory')
  return readFileSync(target)
}
/** Only declared outputs are eligible; source workspaces are never scanned or silently copied. */
export function collectWorkspaceCandidates(state: IsolatedWorkspace, outputs: ReadonlyArray<{ path: string; binary?: boolean }>): CandidateFile[] {
  if (state.status === 'integrated') throw new Error('Workspace delivery was already integrated')
  const seen = new Set<string>()
  return outputs.map(output => {
    if (!output.path || isAbsolute(output.path) || !inside(state.directory,resolve(state.directory,output.path))) throw new Error('Output must be relative to its work directory')
    const target = resolve(state.directory,output.path)
    const normalized = relative(state.directory,target).split(sep).join('/')
    if (normalized.split('/').some(part => part.toLowerCase() === '.git')) throw new Error('Repository metadata is not an output')
    if (seen.has(target)) throw new Error('Duplicate workspace output')
    seen.add(target)
    let base: Buffer | null
    if (state.kind === 'git') {
      if (!state.baseSnapshot) throw new Error('Missing Git input snapshot')
      const options: ExecFileSyncOptionsWithBufferEncoding = { cwd: state.directory, env: { ...process.env, LC_ALL:'C' }, stdio:['ignore','pipe','pipe'], maxBuffer: Infinity }
      const prefix = execFileSync('git',['rev-parse','--show-prefix'],options).toString().trim()
      const gitPath = `${prefix}${normalized}`
      const entry = execFileSync('git',['ls-tree','--full-tree','-z',state.baseSnapshot,'--',gitPath],options)
      base = entry.length ? execFileSync('git',['show',`${state.baseSnapshot}:${gitPath}`],options) : null
    } else {
      if (!state.baseDirectory) throw new Error('Missing file input snapshot; recreate the isolated workspace')
      base = readRegular(state.baseDirectory,output.path)
      const inputKey = relative(state.directory, target)
      const expectedHash = Object.hasOwn(state.inputs, inputKey) ? state.inputs[inputKey] : undefined
      const actualHash = base === null ? undefined : createHash('sha256').update(base).digest('hex')
      if (actualHash !== expectedHash) throw new Error('File input snapshot changed; restore the recorded baseline before integration')
    }
    return { path:normalized, base, candidate:readRegular(state.directory,output.path), binary:output.binary }
  })
}

/** Discover actual edits in the owned snapshot, never filenames in model prose. */
export function discoverWorkspaceOutputs(state: IsolatedWorkspace): Record<string, string> {
  const paths = new Set<string>()
  if (state.kind === 'git') {
    if (!state.baseSnapshot) throw new Error('Missing Git input snapshot')
    const options = { cwd: state.directory, encoding: 'utf8' as const, maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] }
    for (const args of [
      ['diff', '--no-ext-diff', '--name-only', '-z', '--relative', state.baseSnapshot, '--', '.'],
      ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'],
    ]) for (const path of execFileSync('git', args, options).split('\0').filter(Boolean)) paths.add(path)
  } else {
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.toLowerCase() === '.git') continue
        const target = resolve(directory, entry.name)
        if (entry.isSymbolicLink()) throw new Error('Candidate outputs cannot be symbolic links')
        if (entry.isDirectory()) visit(target)
        else if (entry.isFile()) paths.add(relative(state.directory, target).split(sep).join('/'))
        else throw new Error('Candidate output is not a regular file')
      }
    }
    visit(state.directory)
    for (const path of Object.keys(state.inputs)) paths.add(path.split(sep).join('/'))
  }
  const files = collectWorkspaceCandidates(state, [...paths].map(path => ({ path })))
  const changed = files.filter(file => file.base === null ? file.candidate !== null : file.candidate === null || !file.base.equals(file.candidate))
  // Deletion needs an explicit contract/UI; do not silently apply destructive discoveries.
  if (changed.some(file => file.candidate === null)) throw new Error('Deleted candidate files require an explicit recovery or review; the source was preserved')
  return Object.fromEntries(changed.map(file => [file.path, file.path]))
}
