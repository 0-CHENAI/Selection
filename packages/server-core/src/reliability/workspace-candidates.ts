import { createHash } from 'node:crypto'
import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
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
