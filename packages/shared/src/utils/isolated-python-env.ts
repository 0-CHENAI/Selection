import { join } from 'node:path'

/**
 * Redirect pip/uv/pycache writes into a sandbox-private home.
 *
 * Isolated shells inherit PYTHONUSERBASE from the desktop/server process
 * (userData). That directory is outside the Darwin/Linux write allowlist and is
 * Medium-IL AppData on a Windows Low IL token, so pip would fail or leak into
 * the real user profile. Keep PATH / UV_PYTHON / CRAFT_GIT so the bundled
 * interpreter still runs; only the write roots move.
 */
export function withIsolatedPythonHome(
  home: string,
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...process.env, ...env }
  delete next.VIRTUAL_ENV
  next.PYTHONUSERBASE = join(home, 'python-user')
  next.PIP_CACHE_DIR = join(home, '.cache', 'pip')
  next.UV_CACHE_DIR = join(home, '.cache', 'uv')
  next.PYTHONPYCACHEPREFIX = join(home, '.pycache')
  next.UV_PYTHON_DOWNLOADS = 'never'
  return next
}
