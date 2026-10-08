import type { TaskDeliveryReceipt } from './task-delivery-receipt'
import type { WorkspaceDeliveryContract } from './workspace-delivery-contract'
import { isNativeReadOnlyTool, PI_TOOL_NAME_MAP } from '../../../shared/src/agent/backend/pi/constants'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface IsolatedWorkspace {
  version: 1; id: string; sourceRoot: string; directory: string; kind: 'git' | 'files'
  baseCommit?: string; baseSnapshot?: string; inputs: Record<string, string>
  pendingDelivery?: TaskDeliveryReceipt
  delivery?: TaskDeliveryReceipt
  /** Trusted runtime policy for new Swarm workers without explicit file declarations. */
  autoDelivery?: true
  deliveryContract?: WorkspaceDeliveryContract
  deliveryProgress?: {
    phase: 'validating' | 'integrating' | 'conflict' | 'validation-failed'
    checks?: string[]
    conflicts?: string[]
  }
  baseDirectory?: string
  status: 'ready' | 'candidate' | 'conflict' | 'integrated'
}
export function inside(root: string, path: string): boolean {
  const r = relative(root, path); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r))
}
const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => execFileSync('git', args, { cwd, env: { ...process.env, ...env, LC_ALL: 'C' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** An alternate index snapshots dirty files without touching the user's index or refs. */
export function snapshotGit(root: string, metadataDir: string): { head: string; snapshot: string } {
  const head = git(root, ['rev-parse', 'HEAD'])
  mkdirSync(metadataDir, { recursive: true })
  const index = join(metadataDir, `${randomUUID()}.index`)
  const env = { ...process.env, GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: 'Selection', GIT_AUTHOR_EMAIL: 'selection@localhost', GIT_COMMITTER_NAME: 'Selection', GIT_COMMITTER_EMAIL: 'selection@localhost' }
  try {
    git(root, ['read-tree', head], env)
    git(root, ['add', '-A', '--', '.'], env)
    const tree = git(root, ['write-tree'], env)
    const snapshot = git(root, ['commit-tree', tree, '-p', head, '-m', 'Selection isolated input snapshot'], env)
    return { head, snapshot }
  } finally { rmSync(index, { force: true }); rmSync(`${index}.lock`, { force: true }) }
}
export function prepareIsolatedWorkspace(sourceRoot: string, storage: string, declaredInputs: string[] = []): IsolatedWorkspace {
  const root = realpathSync(sourceRoot)
  if (inside(root, resolve(storage))) throw new Error('Isolated storage must be outside the source project')
  mkdirSync(storage, { recursive: true })
  const id = randomUUID(), directory = join(storage, id, 'work')
  let gitRoot: string | undefined
  try { gitRoot = realpathSync(git(root, ['rev-parse', '--show-toplevel'])) } catch (error) {
    // A broken Git environment must not silently downgrade to a partial file copy.
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? ''
    if (!stderr.includes('not a git repository')) throw error
  }
  const state: IsolatedWorkspace = { version: 1, id, sourceRoot: root, directory, kind: 'files', inputs: {}, status: 'ready' }
  if (gitRoot) {
    if (inside(gitRoot, realpathSync(storage))) throw new Error('Isolated storage must be outside the source repository')
    // A project subdirectory still needs the repository root for a faithful snapshot.
    const { head, snapshot } = snapshotGit(gitRoot, join(storage, id))
    const checkout = join(storage, id, 'checkout')
    git(gitRoot, ['worktree', 'add', '--detach', checkout, snapshot])
    state.kind = 'git'; state.baseCommit = head; state.baseSnapshot = snapshot
    state.directory = join(checkout, relative(gitRoot, root))
    // Reuse installed, ignored dependencies as read references; both file guards
    // and native Shell confinement prohibit writes through these links.
    const manifests = execFileSync('git', ['ls-files', '-z', '--', 'package.json', '**/package.json'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
    for (const manifest of manifests) {
      const source = join(root, dirname(manifest), 'node_modules')
      const target = join(state.directory, dirname(manifest), 'node_modules')
      if (!existsSync(source) || existsSync(target)) continue
      try { execFileSync('git', ['check-ignore', '-q', '--', source], { cwd: root, stdio: 'ignore' }) }
      catch { continue }
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(realpathSync(source), target, process.platform === 'win32' ? 'junction' : 'dir')
    }
  } else {
    mkdirSync(directory, { recursive: true })
    state.baseDirectory = join(storage, id, 'base')
    mkdirSync(state.baseDirectory, { recursive: true })
    for (const input of declaredInputs) {
      const src = realpathSync(resolve(root, input))
      if (!inside(root, src) || !lstatSync(src).isFile()) throw new Error('Inputs must be declared regular files inside the source project')
      const name = relative(root, src), dest = join(directory, name)
      const inputBytes = readFileSync(src)
      mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, inputBytes)
      const baseline = join(state.baseDirectory, name)
      mkdirSync(dirname(baseline), { recursive: true }); writeFileSync(baseline, inputBytes)
      state.inputs[name] = createHash('sha256').update(inputBytes).digest('hex')
    }
  }
  writeFileSync(join(storage, id, 'workspace.json'), JSON.stringify(state), { mode: 0o600 })
  return state
}
/** This is a file-tool guard, not a shell sandbox. Unknown tools cannot claim confinement. */
export function assertIsolatedTool(state: IsolatedWorkspace, toolName: string, input: Record<string, unknown>, confinedShellDirectory?: string): void {
  if (isNativeReadOnlyTool(toolName) || ['WebSearch', 'WebFetch'].includes(PI_TOOL_NAME_MAP[toolName] ?? toolName)) return
  // These host-owned session tools validate their own run/attempt identity and
  // cannot write project files. External tools with similar names stay blocked.
  if (/^(?:mcp__session__|session__)?(?:submit_answer|submit_task_output|submit_task_node_verdict|task_help|get_session_info|get_task_results|session_history|task_context|update_task_list)$/.test(toolName)) return
  if (state.delivery || state.pendingDelivery) throw new Error('This candidate is frozen for delivery; create a new worker for further changes')
  if (['Bash', 'bash'].includes(toolName) && confinedShellDirectory === realpathSync(state.directory)) return
  if (!['Write', 'write', 'Edit', 'edit', 'MultiEdit'].includes(toolName)) throw new Error('This isolated task requires a sandbox for shell or external write tools; the tool has not run.')
  const path = input.file_path ?? input.path
  if (typeof path !== 'string') throw new Error('Missing output path')
  const target = resolve(state.directory, path)
  if (relative(state.directory, target).split(sep).some(part => part.toLowerCase() === '.git')) throw new Error('Repository metadata cannot be edited by an isolated task')
  if (!inside(state.directory, target)) throw new Error('Output must stay inside the isolated work directory')
  // Verify the closest existing ancestor, including symlinked parents.
  let ancestor = target
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error('Invalid output path')
    ancestor = parent
  }
  if (!inside(realpathSync(state.directory), realpathSync(ancestor))) throw new Error('Output path escapes through a symbolic link')
}

/** Remove only a runtime-created workspace after its result no longer needs inspection. */
export function disposeIsolatedWorkspace(state: IsolatedWorkspace, storage: string): void {
  if (!/^[a-f0-9-]+$/.test(state.id)) throw new Error('Invalid isolated workspace identity')
  const container = resolve(storage, state.id)
  if (!inside(container, resolve(state.directory)) || resolve(state.directory) === container) throw new Error('Workspace cleanup target is outside its owned directory')
  if (state.kind === 'git') {
    const checkout = join(container, 'checkout')
    if (!inside(checkout, resolve(state.directory))) throw new Error('Unexpected Git workspace layout')
    git(state.sourceRoot, ['worktree', 'remove', '--force', checkout])
  }
  rmSync(container, { recursive: true, force: true })
}
