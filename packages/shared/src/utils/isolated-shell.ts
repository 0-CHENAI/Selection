import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute, sep } from 'node:path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'
import { withIsolatedPythonHome } from './isolated-python-env'
import { createWindowsIsolatedShell } from './windows-isolated-shell'

async function waitForTermination(pid: number, namespace: boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    let alive: boolean
    if (namespace) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
        alive = !['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]!)
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        alive = false
      }
    } else {
      const processes = execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' })
      alive = processes.split('\n').some(line => {
        const [group, state] = line.trim().split(/\s+/)
        return Number(group) === pid && state && !state.startsWith('Z') && !state.startsWith('X')
      })
    }
    if (!alive) return
    if (Date.now() >= deadline) throw new Error('Isolated Shell processes did not terminate')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Only native confinement may authorize Shell in a candidate workspace. */
export function createIsolatedShell(directory: string, options: { denyExternalBrowsers?: boolean; officeDocument?: { path: string; binary: string } } = {}): { directory: string; operations: BashOperations; dispose: () => void } | undefined {
  const root = realpathSync(directory)
  if (process.platform === 'win32') return createWindowsIsolatedShell(root, options)
  if (process.platform !== 'darwin' && process.platform !== 'linux') return undefined
  if (process.platform === 'linux' && !['/usr/bin/bwrap', '/bin/bwrap'].some(path => existsSync(path))) return undefined
  const officeDocument = options.officeDocument && { path: realpathSync(options.officeDocument.path), binary: realpathSync(options.officeDocument.binary) }
  if (officeDocument) {
    const path = relative(root, officeDocument.path)
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new Error('Office document escapes isolated workspace')
  }
  // .NET Unix sockets have a 104-byte path limit; keep private IPC scratch short.
  const temporary = realpathSync(mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'sel-')))
  const home = join(temporary, 'home')
  mkdirSync(home)
  const children = new Set<number>()
  let nextCommand = 0
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
    // file-read* + process-exec cover bundled vendor/git and vendor/python, including
    // app paths with spaces (JSON.stringify quotes the write roots). Writes stay on
    // the candidate and private $TMPDIR home — not userData PYTHONUSERBASE.
    prefix = ['-p', `(version 1)(deny default)(allow file-read*)(allow process-exec process-fork)(allow sysctl-read)(allow file-write-data (literal "/dev/null"))(allow signal (target self))(allow file-write* (subpath ${JSON.stringify(root)}) (subpath ${JSON.stringify(temporary)}))(allow network-outbound (remote unix-socket (subpath ${JSON.stringify(temporary)})))(allow network-bind network-inbound (local unix-socket (subpath ${JSON.stringify(temporary)})))(deny file-write* (subpath ${JSON.stringify(join(root, '.git'))}))`, '/bin/bash', '--noprofile', '--norc', '-c']
  } else if (process.platform === 'linux') {
    const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find(path => existsSync(path))
    if (!bwrap) { dispose(); return undefined }
    executable = bwrap
    // Read-only root keeps vendor/git and vendor/python executable; writes stay on
    // the candidate and private home (PYTHONUSERBASE is redirected there).
    prefix = ['--die-with-parent', '--new-session', '--unshare-all', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', root, root, '--bind', temporary, temporary, '--chdir', root]
    if (existsSync(join(root, '.git'))) prefix.push('--ro-bind', join(root, '.git'), join(root, '.git'))
    prefix.push('/bin/bash', '--noprofile', '--norc', '-c')
  } else { dispose(); return undefined }
  if (process.platform === 'darwin' && options.denyExternalBrowsers) {
    // Applies to descendants too, including browsers spawned inside OfficeCLI
    // or Python. Deny before exec, so Chrome never starts and cannot crash.
    prefix[1] += ' (deny process-exec (regex #".*/([Gg]oogle [Cc]hrome[^/]*|[Cc]hrome[^/]*|[Cc]hromium[^/]*|[Ff]irefox[^/]*|[Mm]icrosoft [Ee]dge[^/]*|[Ss]afari[^/]*|[Mm][Ss][Ee]dge[^/]*)(/.*)?$"))'
  }
  const environment = (env?: NodeJS.ProcessEnv) => ({
    ...withIsolatedPythonHome(home, env),
    HOME: home, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
    XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'),
    DOTNET_CLI_HOME: home, DOTNET_EnableDiagnostics: '0', PYTHONDONTWRITEBYTECODE: '1',
  })
  // Executable presence is insufficient: kernel/container policy may reject it.
  try { execFileSync(executable, [...prefix, 'exit 0'], { cwd: root, env: environment(), stdio: 'ignore' }) } catch { dispose(); return undefined }
  return { directory: root, dispose, operations: { exec(command, cwd, { onData, signal, timeout, env }) {
    signal?.throwIfAborted()
    if (disposed) throw new Error('Isolated Shell has been disposed')
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2_147_483_647)) throw new Error('Invalid Shell timeout')
    const target = realpathSync(cwd), path = relative(root, target)
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new Error('Shell directory escapes isolated workspace')
    return new Promise((resolve, reject) => {
      // The supervisor outlives the model's command (including exit/exec), so
      // resident edits reach disk before process-group cleanup kills the daemon.
      // Run the close in the same confinement and private IPC environment.
      const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
      const transaction = officeDocument ? [
        `/bin/bash --noprofile --norc -c ${quote(command)}`,
        'selection_office_command_status=$?',
        `selection_office_flush_output=$(${quote(officeDocument.binary)} close ${quote(officeDocument.path)} 2>&1)`,
        'selection_office_flush_status=$?',
        'if [ "$selection_office_flush_status" -ne 0 ]; then',
        '  printf "Office candidate flush failed: %s\\n" "$selection_office_flush_output" >&2',
        '  exit "$selection_office_flush_status"',
        'fi',
        'exit "$selection_office_command_status"',
      ].join('\n') : command
      const args = [...prefix, transaction]
      if (process.platform === 'linux') args[args.indexOf('--chdir') + 1] = target
      const namespace = process.platform === 'linux'
      if (namespace) args.unshift('--info-fd', '3')
      const infoPath = join(temporary, `process-${nextCommand++}.json`)
      const infoFd = namespace ? openSync(infoPath, 'wx+', 0o600) : undefined
      if (namespace) rmSync(infoPath)
      const child = (() => {
        try {
          return spawn(executable, args, { cwd: target, env: environment(env), detached: true, stdio: infoFd === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', infoFd] })
        } catch (error) { if (infoFd !== undefined) closeSync(infoFd); throw error }
      })()
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
        if (infoFd !== undefined) closeSync(infoFd)
        if (child.pid) children.delete(child.pid)
        if (disposed && !children.size) rmSync(temporary, { recursive: true, force: true })
      }
      const consume = (bytes: Buffer) => {
        if (outputError !== undefined) return
        try { onData(bytes) } catch (error) { outputError = error ?? new Error('Shell output handling failed'); stop() }
      }
      child.stdout!.on('data', consume); child.stderr!.on('data', consume)
      signal?.addEventListener('abort', stop, { once: true })
      if (signal?.aborted) stop()
      let spawnError: unknown
      child.once('error', error => { spawnError = error })
      // Kill children on parent exit, before inherited pipes can hold `close` open.
      child.once('exit', stop)
      child.once('close', async exitCode => {
        try {
          if (spawnError) throw spawnError
          const sandboxInfo = infoFd === undefined ? '' : readFileSync(`/proc/self/fd/${infoFd}`, 'utf8')
          if (namespace && exitCode === 0 && !sandboxInfo) throw new Error('Missing sandbox process ID')
          if (namespace && sandboxInfo) {
            // bwrap's monitor can exit before its PID namespace has finished dying.
            const pid: unknown = JSON.parse(sandboxInfo)['child-pid']
            if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid sandbox process ID')
            try { process.kill(pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
            await waitForTermination(pid, true)
          }
          if (child.pid) await waitForTermination(child.pid, namespace)
          if (outputError !== undefined) throw outputError
          if (terminationError) throw terminationError
          if (signal?.aborted) throw new Error('aborted')
          if (timedOut) throw new Error(`timeout:${timeout}`)
          resolve({ exitCode })
        } catch (error) { reject(error) } finally { cleanup() }
      })
    })
  } } }
}
