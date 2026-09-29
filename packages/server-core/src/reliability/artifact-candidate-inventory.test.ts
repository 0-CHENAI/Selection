import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactCandidateInventory } from './artifact-candidate-inventory'

test('the filesystem ledger finds created and edited Chinese paths without treating old input as an output', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-inventory-'))
  try {
    const data = join(root, 'input.pdf')
    const report = join(root, '中文 报告 (1).html')
    const helper = join(root, 'helper.ts')
    writeFileSync(data, '{}')
    writeFileSync(helper, 'before')
    const inventory = new ArtifactCandidateInventory([root])
    writeFileSync(report, '<html>hello</html>')
    writeFileSync(helper, 'after')
    expect(inventory.changed()).toEqual([report])
    expect(inventory.changed()).not.toContain(data)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('includes every allowed draft and modified document while excluding internal directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-inventory-many-'))
  try {
    const report = join(root, 'existing.docx')
    writeFileSync(report, 'before')
    const inventory = new ArtifactCandidateInventory([root])
    writeFileSync(report, 'after with edits')
    const drafts = Array.from({ length: 45 }, (_, index) => join(root, `draft-${index}.md`))
    for (const path of drafts) writeFileSync(path, 'draft')
    for (const directory of ['node_modules', '.git']) {
      mkdirSync(join(root, directory))
      writeFileSync(join(root, directory, 'internal.txt'), 'internal')
    }
    expect(inventory.changed().sort()).toEqual([report, ...drafts].sort())
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an unreadable subtree does not suppress changes in readable folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-inventory-access-'))
  const blocked = join(root, 'blocked')
  try {
    mkdirSync(blocked)
    writeFileSync(join(blocked, 'private.pdf'), 'private')
    chmodSync(blocked, 0o000)
    const inventory = new ArtifactCandidateInventory([root])
    const report = join(root, 'report.pdf')
    writeFileSync(report, 'output')
    expect(inventory.changed()).toContain(report)
  } finally {
    chmodSync(blocked, 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})
