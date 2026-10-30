import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runQuickRatioCli } from './cli/quick-ratio.ts'

const repoRoot = join(import.meta.dir, '../../..')
const fixtureDir = join(repoRoot, 'scripts/fixtures/office-parity/quick-ratio')
const cliPath = join(import.meta.dir, 'cli/quick-ratio.ts')

interface ManifestCase {
  id: string
  argv: string[]
  textStdout: string
  jsonStdout: string
  textSha256: string
  jsonSha256: string
}

interface Manifest {
  dshCommit: string
  scriptPath: string
  scriptSha256: string
  cases: ManifestCase[]
}

const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8')) as Manifest
const sample = JSON.parse(readFileSync(join(fixtureDir, 'input-template.sample.json'), 'utf8')) as {
  id: string
  argv: string[]
  templateSha256: string
}

describe('quick_ratio golden parity', () => {
  test('fixture is pinned to the stage-01 inventory hash', () => {
    const inventory = JSON.parse(readFileSync(join(repoRoot, 'docs/plans/dsh-office-inventory.json'), 'utf8')) as {
      dshCommit: string
      files: Array<{ path: string; sha256: string }>
    }
    const script = inventory.files.find(file => file.path === manifest.scriptPath)
    expect(manifest.dshCommit).toBe(inventory.dshCommit)
    expect(manifest.dshCommit).toBe('588412b9002fcb3ac88751fab7915e050c965563')
    expect(script?.sha256).toBe(manifest.scriptSha256)
    expect(manifest.scriptSha256).toBe('51cd1e8c7742e741b76472e47aeb5ebf508a3367cf8b7190cd80735016313b5d')
  })

  test('P1 uses the input-template example numbers', () => {
    expect(sample.id).toBe('input-template-example')
    expect(sample.templateSha256).toBe('235fcd9768c07b96baf32a34eea747d2647515dc4da067cc9ed5b0c61e1077b3')
    const p1 = manifest.cases.find(item => item.id === sample.id)
    expect(p1?.argv).toEqual(sample.argv)
  })

  for (const item of manifest.cases) {
    test(`${item.id} matches dsh stdout`, () => {
      const text = runQuickRatioCli(item.argv)
      const json = runQuickRatioCli([...item.argv, '--json'])
      expect(text.exitCode).toBe(0)
      expect(text.stderr).toBe('')
      expect(text.stdout).toBe(readFileSync(join(fixtureDir, item.textStdout), 'utf8'))
      expect(json.exitCode).toBe(0)
      expect(json.stderr).toBe('')
      expect(json.stdout).toBe(readFileSync(join(fixtureDir, item.jsonStdout), 'utf8'))
    })
  }

  test('equals form and scientific notation match the P1 JSON golden', () => {
    const golden = readFileSync(join(fixtureDir, 'input-template-example.json.stdout'), 'utf8')
    const equals = runQuickRatioCli([
      '--new-mrr=10000',
      '--expansion=2000',
      '--churned=3000',
      '--contraction=500',
      '--json',
    ])
    const scientific = runQuickRatioCli([
      '--new-mrr', '1e4',
      '--expansion', '2e3',
      '--churned', '3e3',
      '--contraction', '5e2',
      '--json',
    ])
    expect(equals.stdout).toBe(golden)
    expect(scientific.stdout).toBe(golden)
  })

  test('bun executes the CLI and prints the P1 JSON', () => {
    const result = spawnSync(process.execPath, [
      cliPath,
      '--new-mrr', '10000',
      '--expansion', '2000',
      '--churned', '3000',
      '--contraction', '500',
      '--json',
    ], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(readFileSync(join(fixtureDir, 'input-template-example.json.stdout'), 'utf8'))
    expect(result.stderr).toBe('')
  })

  test('missing or invalid arguments exit 2 without stdout', () => {
    for (const argv of [
      ['--churned', '1'],
      ['--new-mrr', 'abc', '--churned', '1'],
      ['--new-mrr', '1', '--churned', '1', '--unknown'],
    ]) {
      const result = runQuickRatioCli(argv)
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr.length).toBeGreaterThan(0)
    }
  })
})
