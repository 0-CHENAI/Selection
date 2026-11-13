import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { withIsolatedPythonHome } from './isolated-python-env'

describe('withIsolatedPythonHome', () => {
  it('redirects pip writes into the sandbox home and keeps the bundled interpreter', () => {
    const home = '/tmp/sel-home/Application Support/session'
    const env = withIsolatedPythonHome(home, {
      PATH: '/app/vendor/python/bin:/app/vendor/git/bin',
      UV_PYTHON: '/app/vendor/python/bin/python3',
      CRAFT_GIT: '/app/vendor/git/bin/git',
      PYTHONUSERBASE: '/Users/me/Library/Application Support/Selection/python-user',
      VIRTUAL_ENV: '/Users/me/Library/Application Support/Selection/python-venv',
    })
    expect(env.PYTHONUSERBASE).toBe(join(home, 'python-user'))
    expect(env.PIP_CACHE_DIR).toBe(join(home, '.cache', 'pip'))
    expect(env.UV_CACHE_DIR).toBe(join(home, '.cache', 'uv'))
    expect(env.PYTHONPYCACHEPREFIX).toBe(join(home, '.pycache'))
    expect(env.UV_PYTHON_DOWNLOADS).toBe('never')
    expect(env.VIRTUAL_ENV).toBeUndefined()
    expect(env.UV_PYTHON).toBe('/app/vendor/python/bin/python3')
    expect(env.CRAFT_GIT).toBe('/app/vendor/git/bin/git')
    expect(env.PATH).toContain('/app/vendor/git/bin')
  })
})
