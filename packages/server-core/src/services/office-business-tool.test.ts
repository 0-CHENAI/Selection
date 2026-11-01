import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { runMetricsCli, runQuickRatioCli } from '@craft-agent/office-business-runtime'
import { runOfficeBusiness } from './office-business-tool.ts'

const repoRoot = join(import.meta.dir, '../../../..')

test('office_business metrics and quick ratio match the bun CLI stdout', () => {
  const session = { workspaceRoot: mkdtempSync(join(tmpdir(), 'office-business-')), canWrite: true }
  try {
    const metrics = runOfficeBusiness(session, { command: 'metrics', mrr: 50000, customers: 100, churned: 5 })
    expect(metrics.exitCode).toBe(0)
    expect(metrics.stdout).toBe(runMetricsCli(['--mrr', '50000', '--customers', '100', '--churned', '5', '--json']).stdout)
    expect(metrics.stdout).toBe(readFileSync(join(repoRoot, 'scripts/fixtures/office-parity/metrics/partial.json.stdout'), 'utf8'))

    const ratio = runOfficeBusiness(session, { command: 'quick-ratio', new_mrr: 10000, expansion: 2000, churned: 3000, contraction: 500 })
    expect(ratio.stdout).toBe(runQuickRatioCli(['--new-mrr', '10000', '--expansion', '2000', '--churned', '3000', '--contraction', '500', '--json']).stdout)
    expect(ratio.stdout).toContain('"status": "HEALTHY"')
  } finally {
    rmSync(session.workspaceRoot, { recursive: true, force: true })
  }
})

test('office_business refuses paths outside the workspace and read-only writes', () => {
  const session = { workspaceRoot: mkdtempSync(join(tmpdir(), 'office-business-')), canWrite: false }
  try {
    writeFileSync(join(session.workspaceRoot, 'notes.md'), '# 会议纪要\n')
    const inside = runOfficeBusiness(session, { command: 'validate-minutes', path: 'notes.md' })
    expect(inside.exitCode).toBe(1)
    expect(() => runOfficeBusiness(session, { command: 'validate-minutes', path: '../secret.md' })).toThrow(/工作区/)
    expect(() => runOfficeBusiness(session, {
      command: 'infographic',
      output: 'out.html',
      config: { title: '季度营收', type: 'stats' },
    })).toThrow(/只读/)
  } finally {
    rmSync(session.workspaceRoot, { recursive: true, force: true })
  }
})
