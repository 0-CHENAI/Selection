import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIsolatedShell } from '../../packages/shared/src/utils/isolated-shell'

const root = mkdtempSync(join(tmpdir(), 'selection-ci-shell-'))
const shell = createIsolatedShell(root)
try {
  if (!shell) {
    console.error(
      `::error::Infra: native confinement is unavailable on ${process.platform}/${process.arch}. `
      + 'Linux CI needs a working bubblewrap user namespace; macOS needs sandbox-exec. '
      + 'This is not a product assertion failure. See docs/ci.md.',
    )
    process.exit(1)
  }
  console.log(`Native confinement is available on ${process.platform}/${process.arch}`)
} finally {
  shell?.dispose()
  rmSync(root, { recursive: true, force: true })
}
