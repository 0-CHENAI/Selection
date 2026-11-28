import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
    writeFileSync(join(root, 'snapshot.txt'), 'search cache')
    writeFileSync(join(root, 'REPORT.TXT'), 'plain text')
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
    for (const directory of ['node_modules', '.git', '.venv', '__pycache__', '.next', '.cache']) {
      mkdirSync(join(root, directory))
      writeFileSync(join(root, directory, 'internal.md'), 'internal')
    }
    expect(inventory.changed().sort()).toEqual([report, ...drafts].sort())
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a session-folder pptx is a deliverable and the scratch deck is not', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'artifact-inventory-ppt-'))
  const session = join(workspace, 'sessions', 'current')
  const workingDirectory = mkdtempSync(join(tmpdir(), 'artifact-inventory-wd-'))
  try {
    mkdirSync(join(session, 'data'), { recursive: true })
    writeFileSync(join(session, 'data', 'deck.pptx'), 'scratch')
    const sessionInventory = new ArtifactCandidateInventory([workspace, session], workspace)
    const sessionFile = join(session, '季度经营会.pptx')
    writeFileSync(sessionFile, 'pptx')
    writeFileSync(join(session, 'data', 'again.pptx'), 'still scratch')
    expect(sessionInventory.changed()).toEqual([sessionFile])

    const directoryInventory = new ArtifactCandidateInventory([workingDirectory, session])
    const delivered = join(workingDirectory, '季度经营会.pptx')
    writeFileSync(delivered, 'pptx')
    expect(directoryInventory.changed()).toEqual([delivered])
  } finally {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(workingDirectory, { recursive: true, force: true })
  }
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


test('session outputs become card candidates while identical data files remain scratch', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-destinations-'))
  const session = join(root, 'sessions', 'test-session')
  try {
    for (const folder of ['outputs', 'data']) mkdirSync(join(session, folder), { recursive: true })
    const inventory = new ArtifactCandidateInventory([root, session], root)
    writeFileSync(join(session, 'outputs', '报告.docx'), 'final')
    writeFileSync(join(session, 'data', '报告.docx'), 'draft')
    expect(inventory.changed()).toEqual([join(session, 'outputs', '报告.docx')])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('existedAtStart matches canonical paths and tracks excludes ignored or sibling subtrees', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-tracks-'))
  const session = join(root, 'sessions', 'current')
  const sibling = join(root, 'sessions', 'other')
  const nodeModules = join(root, 'node_modules', 'pkg')
  const sessionMeta = join(session, 'meta')
  try {
    for (const dir of [session, sibling, nodeModules, sessionMeta]) mkdirSync(dir, { recursive: true })
    const existing = join(root, 'existing.html')
    const siblingFile = join(sibling, 'old.html')
    const depReadme = join(nodeModules, 'README.md')
    const metaDoc = join(sessionMeta, 'note.md')
    writeFileSync(existing, 'before')
    writeFileSync(siblingFile, 'sibling')
    writeFileSync(depReadme, 'dep')
    writeFileSync(metaDoc, 'meta')

    const inventory = new ArtifactCandidateInventory([root, session], root)
    const canonicalExisting = realpathSync(existing)
    const canonicalNew = join(realpathSync(root), 'new-diagram.html')
    const canonicalSessionNew = join(realpathSync(session), 'summary.md')
    const canonicalSibling = realpathSync(siblingFile)
    const canonicalDep = realpathSync(depReadme)
    const canonicalMeta = realpathSync(metaDoc)

    expect(inventory.existedAtStart(existing)).toBe(true)
    expect(inventory.existedAtStart(canonicalExisting)).toBe(true)
    expect(inventory.existedAtStart(canonicalNew)).toBe(false)

    expect(inventory.tracks(canonicalExisting)).toBe(true)
    expect(inventory.tracks(canonicalNew)).toBe(true)
    expect(inventory.tracks(canonicalSessionNew)).toBe(true)
    expect(inventory.tracks(canonicalSibling)).toBe(false)
    expect(inventory.tracks(canonicalDep)).toBe(false)
    expect(inventory.tracks(canonicalMeta)).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
