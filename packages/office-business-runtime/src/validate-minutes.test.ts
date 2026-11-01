import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runValidateMinutesCli } from './cli/validate-minutes.ts'
import { validateMinutes } from './validate-minutes.ts'

const repoRoot = join(import.meta.dir, '../../..')
const fixtureDir = join(repoRoot, 'scripts/fixtures/office-parity/validate-minutes')

interface ManifestCase {
  id: string
  input: string
  stdout: string
  exitCode: number
}

interface Manifest {
  dshCommit: string
  scriptPath: string
  scriptSha256: string
  cases: ManifestCase[]
}

const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8')) as Manifest

describe('validate_minutes golden parity', () => {
  test('fixture is pinned to the stage-01 inventory hash', () => {
    const inventory = JSON.parse(readFileSync(join(repoRoot, 'docs/plans/dsh-office-inventory.json'), 'utf8')) as {
      dshCommit: string
      files: Array<{ path: string; sha256: string }>
    }
    const script = inventory.files.find(file => file.path === manifest.scriptPath)
    expect(manifest.dshCommit).toBe('588412b9002fcb3ac88751fab7915e050c965563')
    expect(script?.sha256).toBe(manifest.scriptSha256)
    expect(manifest.scriptSha256).toBe('cca5ddea85bb07a64a93b012393b62ebc92777ec0cbb9c7638cbeb5ea38cc720')
  })

  for (const item of manifest.cases) {
    test(`${item.id} matches dsh stdout and exit code`, () => {
      const content = readFileSync(join(fixtureDir, item.input), 'utf8')
      const report = validateMinutes(content)
      const golden = readFileSync(join(fixtureDir, item.stdout), 'utf8')
      expect(`${report.text}\n`).toBe(golden)
      expect(report.exitCode).toBe(item.exitCode)
    })
  }

  test('bun CLI writes the passing report and rejects a missing path', () => {
    const cli = join(import.meta.dir, 'cli/validate-minutes.ts')
    const input = join(fixtureDir, 'pass-basic.md')
    const result = spawnSync(process.execPath, [cli, input], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(readFileSync(join(fixtureDir, 'pass-basic.md.stdout'), 'utf8'))
    expect(result.stderr).toBe('')

    const usage = runValidateMinutesCli([])
    expect(usage.exitCode).toBe(1)
    expect(usage.stdout).toBe('')
    expect(usage.stderr).toContain('validate-minutes.ts')
  })
})
