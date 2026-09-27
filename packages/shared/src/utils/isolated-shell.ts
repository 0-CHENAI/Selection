import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'

/** Only native confinement may authorize Shell in a candidate workspace. */
export function createIsolatedShell(directory: string): { directory: string; operations: BashOperations; dispose: () => void } | undefined {
  const root = realpathSync(directory)
  if (process.platform !== 'darwin' && process.platform !== 'linux') return undefined
  if (process.platform === 'linux' && !['/usr/bin/bwrap', '/bin/bwrap'].some(path => existsSync(path))) return undefined
  // .NET Unix sockets have a 104-byte path limit; keep private IPC scratch short.
  const temporary = realpathSync(mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'sel-')))
  const home = join(temporary, 'home')
  mkdirSync(home)
  const children = new Set<number>()
  let disposed = false
  const dispose = () => {
    disposed = true
    for (const pid of children) {
      try { process.kill(-pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    if (!children.size) rmSync(temporary, { recursive: true, force: true })
  }
  let executable: string
  let prefix: string[]
  if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    executable = '/usr/bin/sandbox-exec'
    prefix = ['-p', `(version 1)(deny default)(allow file-read*)(allow process-exec process-fork)(allow sysctl-read)(allow file-write-data (literal "/dev/null"))(allow signal (target self))(allow file-write* (subpath ${JSON.stringify(root)}) (subpath ${JSON.stringify(temporary)}))(allow network-outbound (remote unix-socket (subpath ${JSON.stringify(temporary)})))(allow network-bind network-inbound (local unix-socket (subpath ${JSON.stringify(temporary)})))(deny file-write* (subpath ${JSON.stringify(join(root, '.git'))}))`, '/bin/bash', '--noprofile', '--norc', '-c']
  } else if (process.platform === 'linux') {
    const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find(path => existsSync(path))
    if (!bwrap) { dispose(); return undefined }
    executable = bwrap
    // Mount private /tmp first so it cannot hide candidate directories under /tmp.
    prefix = ['--die-with-parent', '--new-session', '--unshare-all', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', root, root, '--bind', temporary, temporary, '--chdir', root]
    if (existsSync(join(root, '.git'))) prefix.push('--ro-bind', join(root, '.git'), join(root, '.git'))
    prefix.push('/bin/bash', '--noprofile', '--norc', '-c')
  } else { dispose(); return undefined }
  const environment = (env?: NodeJS.ProcessEnv) => ({ ...process.env, ...env, HOME: home, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
    XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'), DOTNET_CLI_HOME: home, DOTNET_EnableDiagnostics: '0', PYTHONDONTWRITEBYTECODE: '1' })
  // Executable presence is insufficient: kernel/container policy may reject it.
  try { execFileSync(executable, [...prefix, 'exit 0'], { cwd: root, env: environment(), stdio: 'ignore' }) } catch { dispose(); return undefined }
  return { directory: root, dispose, operations: { exec(command, cwd, { onData, signal, timeout, env }) {
    signal?.throwIfAborted()
    if (disposed) throw new Error('Isolated Shell has been disposed')
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2_147_483_647)) throw new Error('Invalid Shell timeout')
    const target = realpathSync(cwd), path = relative(root, target)
    if (isAbsolute(path) || path === '..' || path.startsWith('../')) throw new Error('Shell directory escapes isolated workspace')
    return new Promise((resolve, reject) => {
      const args = [...prefix, command]
      if (process.platform === 'linux') args[args.indexOf('--chdir') + 1] = target
      const child = spawn(executable, args, { cwd: target, env: environment(env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      if (child.pid) children.add(child.pid)
      let timedOut = false
      let terminationError: unknown
      let outputError: unknown
      const stop = () => {
        if (!child.pid) return
        try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') terminationError = error }
      }
      const timer = timeout === undefined ? undefined : setTimeout(() => { timedOut = true; stop() }, timeout * 1000)
      const cleanup = () => {
        if (timer) clearTimeout(timer); signal?.removeEventListener('abort', stop)
        if (child.pid) children.delete(child.pid)
        if (disposed && !children.size) rmSync(temporary, { recursive: true, force: true })
      }
      const consume = (bytes: Buffer) => {
        if (outputError !== undefined) return
        try { onData(bytes) } catch (error) { outputError = error ?? new Error('Shell output handling failed'); stop() }
      }
      child.stdout.on('data', consume); child.stderr.on('data', consume)
      signal?.addEventListener('abort', stop, { once: true })
      if (signal?.aborted) stop()
      child.once('error', error => { cleanup(); reject(error) })
      // Kill children on parent exit, before inherited pipes can hold `close` open.
      child.once('exit', stop)
      child.once('close', exitCode => {
        cleanup()
        if (outputError !== undefined) reject(outputError)
        else if (terminationError) reject(terminationError)
        else if (signal?.aborted) reject(new Error('aborted'))
        else if (timedOut) reject(new Error(`timeout:${timeout}`))
        else resolve({ exitCode })
      })
    })
  } } }
}
