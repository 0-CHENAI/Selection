import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

// gh only reads its keyring after finding a configured account. Point shell tools
// at an unused per-process configuration path, never switch the user's gh login.
const ghConfig = join(tmpdir(), 'selection-gh-' + randomUUID())
export function githubShellEnvironment(env: NodeJS.ProcessEnv) {
  const clean: NodeJS.ProcessEnv = { ...env }
  for (const key of Object.keys(clean)) {
    if (/^(?:GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_CONFIG_DIR|GH_PROMPT_DISABLED)$/i.test(key)) delete clean[key]
  }
  clean.GH_CONFIG_DIR = ghConfig
  clean.GH_PROMPT_DISABLED = '1'
  return clean
}

function unwrapGitCommand(command: string[], cwd: string) {
  const words = [...command]
  const wrappers = new Set(['env', 'command', 'exec', 'nice', 'nohup', 'time', 'sudo', 'xargs'])
  let uncertain = false
  while (words.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) { words.shift(); continue }
    const wrapper = words[0]!.split(/[/\\]/).pop()!.replace(/\.exe$/i, '')
    if (!wrappers.has(wrapper)) break
    words.shift()
    while (words[0]?.startsWith('-')) {
      const option = words.shift()!
      if (option === '--') break
      const takesValue: Record<string, string[]> = {
        env: ['-u', '--unset', '-C', '--chdir', '-a', '--argv0'],
        command: [],
        exec: ['-a'],
        nice: ['-n', '--adjustment'],
        nohup: [],
        time: ['-f', '--format', '-o', '--output'],
        sudo: ['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-D', '--chdir', '-R', '--chroot', '-T', '--command-timeout', '-r', '--role', '-t', '--type'],
        xargs: ['-a', '--arg-file', '-d', '--delimiter', '-E', '--eof', '-I', '--replace', '-L', '--max-lines', '-n', '--max-args', '-P', '--max-procs', '-s', '--max-chars'],
      }
      const options = takesValue[wrapper]!
      const name = option.split('=')[0]!
      const compact = !option.startsWith('--') && options.includes(option.slice(0, 2)) && option.length > 2
      if (options.includes(name) || compact) {
        const value = compact ? option.slice(2) : option.includes('=') ? option.slice(option.indexOf('=') + 1) : words.shift()
        if (!value) uncertain = true
        else if ((wrapper === 'env' && ['-C', '--chdir'].includes(name)) || (wrapper === 'sudo' && ['-D', '--chdir'].includes(name))) cwd = resolve(cwd, value)
      } else if (!({
        env: ['-i', '--ignore-environment', '-0', '--null'],
        command: ['-p'],
        exec: ['-c', '-l'],
        nice: [],
        nohup: [],
        time: ['-p', '-a', '--append', '-q', '--quiet', '-v', '--verbose'],
        sudo: ['-n', '--non-interactive', '-E', '--preserve-env', '-H', '--set-home', '-k', '-K', '-S', '--stdin', '-b', '--background'],
        xargs: ['-0', '--null', '-r', '--no-run-if-empty', '-t', '--verbose', '-p', '--interactive', '-x', '--exit'],
      }[wrapper] ?? []).includes(option)) uncertain = true
    }
  }
  return { words, cwd, uncertain }
}

// Inspect only literal Git writes. Running "remote get-url" does not contact a
// remote or invoke a credential helper. Repositories on other hosts keep their CLI.
export function isGitHubShellWrite(commands: string[][], cwd: string): boolean {
  for (const original of commands) {
    const unwrapped = unwrapGitCommand(original, cwd)
    let [executable, ...args] = unwrapped.words
    if (unwrapped.uncertain && original.some(word => /(?:^|[/\\])git(?:\.exe)?$/i.test(word))) {
      executable = 'git'
      args = ['push']
    }
    if (executable === 'cd' && args.length === 1) cwd = resolve(cwd, args[0]!)
    if (!/(?:^|[/\\])git(?:\.exe)?$/i.test(executable ?? '')) continue
    const gitCwd = unwrapped.cwd
    const global: string[] = []
    let i = 0
    while (args[i]?.startsWith('-')) {
      const option = args[i++]!
      if (/^-[Cc].+/.test(option)) {
        global.push(option.slice(0, 2), option.slice(2))
        continue
      }
      global.push(option)
      if (['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'].includes(option) && args[i]) global.push(args[i++]!)
    }
    const action = args[i++]
    if (action !== 'push' && action !== 'commit') continue
    const git = (...options: string[]) => {
      const result = spawnSync(process.env.CRAFT_GIT || 'git', [...global, ...options], {
        cwd: gitCwd, encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'],
      })
      return result.status === 0 ? result.stdout.trim() : undefined
    }
    const isGitHub = (url: string) => {
      if (githubRemote(url)) return true
      const rewrites = git('config', '--get-regexp', '^url\\..*\\.(insteadof|pushinsteadof)$') ?? ''
      return rewrites.split('\n').some(line => {
        const match = /^url\.(.*)\.(?:push)?insteadof\s+(.+)$/i.exec(line)
        return match && url.startsWith(match[1]!) && githubRemote(match[2]! + url.slice(match[1]!.length))
      })
    }
    const remotes = (git('remote') ?? '').split('\n').filter(Boolean)
    const remoteIsGitHub = (remote: string) =>
      [git('config', '--get', 'remote.' + remote + '.url'), git('config', '--get', 'remote.' + remote + '.pushurl'),
        git('remote', 'get-url', '--push', '--', remote)].some(url => url && isGitHub(url))
    let target: string | undefined
    let uncertain = false
    if (action === 'push') {
      for (; i < args.length; i++) {
        const arg = args[i]!
        if (arg === '--') { target ??= args[++i]; break }
        if (['-o', '--push-option', '--receive-pack', '--exec', '--recurse-submodules'].includes(arg)) { i++; continue }
        if (arg === '--repo') { target = args[++i]; continue }
        if (arg.startsWith('--repo=')) { target = arg.slice(7); continue }
        if (arg.startsWith('-')) {
          if (!/^(?:--[\w-]+(?:=.*)?|-[vfndqu]+|-o.+)$/.test(arg)) uncertain = true
          continue
        }
        target ??= arg
        break
      }
    }
    if (target && isGitHub(target)) return true
    if (target && remotes.includes(target) && !uncertain) {
      if (remoteIsGitHub(target)) return true
      continue
    }
    if (target && /[:/]/.test(target)) {
      const expanded = git('-c', 'remote.selection-routing.url=' + target, 'remote', 'get-url', '--push', 'selection-routing')
      if (expanded && isGitHub(expanded)) return true
      if (!uncertain && expanded) continue
    }
    if (remotes.some(remoteIsGitHub)) return true
  }
  return false
}

function githubRemote(value: string) {
  return /^(?:https?:\/\/(?:[^/@\s]+@)?github\.com\/|ssh:\/\/(?:git@)?github\.com(?::\d+)?\/|git@github\.com:)/i.test(value)
}
