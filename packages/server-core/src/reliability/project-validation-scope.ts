/** Files whose validity depends on their project, beyond parsing individual bytes. */
export function requiresProjectValidation(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  const name = normalized.split('/').at(-1) ?? ''
  if (/\.(?:[cm]?[jt]sx?|py|rs|go|java|[ch](?:pp)?|sh|bash|zsh|ps1|bat|cmd|cs|swift|kt|kts|rb|php|vue|svelte|css|scss|sass|less)$/.test(name)) return true
  if (['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'cargo.toml', 'cargo.lock', 'go.mod', 'go.sum', 'pyproject.toml', 'requirements.txt', 'poetry.lock', 'uv.lock', 'gemfile', 'gemfile.lock', 'composer.json', 'composer.lock', 'makefile', 'dockerfile', 'cmakelists.txt'].includes(name)) return true
  return /^(?:tsconfig|jsconfig)(?:\.[^.]+)*\.json$/.test(name)
    || /^(?:\.eslintrc|\.babelrc)(?:\..+)?$/.test(name)
    || normalized.includes('.github/workflows/')
}
