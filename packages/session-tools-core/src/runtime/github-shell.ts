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

// Inspect only literal Git writes. Running "remote get-url" does not contact a
// remote or invoke a credential helper. Repositories on other hosts keep their CLI.
export function isGitHubShellWrite(commands: string[][], cwd: string): boolean {
  for (const [executable, ...args] of commands) {
    if (executable === 'cd' && args.length === 1) cwd = resolve(cwd, args[0]!)
    if (!/(?:^|[/\\])git(?:\.exe)?$/i.test(executable ?? '')) continue
    let dir = cwd
    let i = 0
    while (args[i]?.startsWith('-')) {
      const option = args[i++]
      if (option === '-C' && args[i]) dir = resolve(dir, args[i++]!)
      else if (option === '-c' || option === '--git-dir' || option === '--work-tree') i++
    }
    const action = args[i++]
    if (action !== 'push' && action !== 'commit') continue
    const target = action === 'push' ? args.slice(i).find(arg => !arg.startsWith('-')) : undefined
    if (target && githubRemote(target)) return true
    const remote = target && /^[\w.-]+$/.test(target) ? target : 'origin'
    const result = spawnSync(process.env.CRAFT_GIT || 'git', ['remote', 'get-url', '--push', '--', remote], {
      cwd: dir, encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.status === 0 && githubRemote(result.stdout.trim())) return true
  }
  return false
}

function githubRemote(value: string) {
  return /^(?:https?:\/\/(?:[^/@\s]+@)?github\.com\/|ssh:\/\/(?:git@)?github\.com(?::\d+)?\/|git@github\.com:)/i.test(value)
}
