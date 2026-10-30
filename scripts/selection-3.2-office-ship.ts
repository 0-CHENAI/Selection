#!/usr/bin/env bun
// Real packaged deck CLI / OfficeCLI acceptance. No mock renderer and no OCR.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkDeck, loadDeckFile } from '../apps/electron/resources/skills/ppt-design/engine/index'

const repo = resolve(import.meta.dir, '..')
const root = join(repo, 'apps/electron/resources/skills/ppt-design')
const cli = join(root, 'engine/deck-cli.mjs')
const officecli = process.env.CRAFT_OFFICECLI
assert(officecli && existsSync(officecli), 'Set CRAFT_OFFICECLI to the prepared native OfficeCLI binary')
const dir = mkdtempSync(join(tmpdir(), 'selection-3.2-ship-'))
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
async function run(args: string[], expected = 0) {
  const process = Bun.spawn([Bun.which('bun')!, cli, ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...Bun.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' } })
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
  assert.equal(code, expected, stderr || stdout)
  return JSON.parse(stdout)
}
const adaptations = JSON.parse(readFileSync(join(root, 'styles/dsh-import-diagnostics.json'), 'utf8')).adaptations as { slug: string; file: string }[]
const templateEvidence = adaptations.map(({ slug, file }) => {
  const source = join(root, 'styles', slug, file)
  const adapted = join(root, 'styles/examples/imported', slug, file)
  const loaded = loadDeckFile(adapted)
  assert(loaded.deck, JSON.stringify(loaded.issues))
  assert.deepEqual(loaded.issues, [])
  assert.deepEqual(checkDeck(loaded.deck), [], `${slug}/${file}`)
  return { slug, file, pages: loaded.deck.pages.length, sourceSha256: hash(source), adaptedSha256: hash(adapted) }
})
const fixture = join(root, 'styles/examples/imported/dsh-monochrome/deck.json')
const deck = JSON.parse(readFileSync(fixture, 'utf8'))
const sourceHash = hash(fixture)
const valid = join(dir, 'deck.json'), pptx = join(dir, 'existing.pptx')
writeFileSync(valid, JSON.stringify(deck))
assert.equal((await run(['check', valid])).status, 'ok')
assert.equal((await run(['render', valid, '--out', pptx])).status, 'ok')
const outputHash = hash(pptx)
const invalid = structuredClone(deck)
invalid.pages[0].elements[0].bounds.x = -10000
const bad = join(dir, 'invalid.json')
writeFileSync(bad, JSON.stringify(invalid))
const rejected = await run(['render', bad, '--out', pptx], 2)
assert.equal(rejected.status, 'needs_revision')
assert(rejected.issues.length > 0)
assert.equal(hash(pptx), outputHash, 'Failed check must preserve the previous deliverable')
const slides = join(dir, 'slides')
mkdirSync(slides)
// First create a real prior-page screenshot, then verify local capture leaves it untouched.
await run(['screenshot', pptx, '--out', slides, '--pages', String(deck.pages.length), '--only-pages', '1', '--officecli', officecli])
const first = join(slides, 'slide-01.png'), firstHash = hash(first), firstMtime = statSync(first).mtimeMs
const selected = await run(['screenshot', pptx, '--out', slides, '--pages', String(deck.pages.length), '--only-pages', '2,4', '--officecli', officecli])
assert.equal(selected.screenshots.renderer, 'officecli')
assert.deepEqual(selected.screenshots.files, [join(slides, 'slide-02.png'), join(slides, 'slide-04.png')])
assert.deepEqual(readdirSync(slides).sort(), ['slide-01.png', 'slide-02.png', 'slide-04.png'])
assert.equal(hash(first), firstHash)
assert.equal(statSync(first).mtimeMs, firstMtime)
for (const file of selected.screenshots.files) assert.equal(readFileSync(file).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
assert.equal(hash(fixture), sourceHash)
assert.equal(hash(pptx), outputHash)
const record = { outputDirectory: dir, templateEvidence, rejectedIssues: rejected.issues, previousOutputPreserved: true, screenshotRenderer: selected.screenshots.renderer, selectedPages: [2, 4], unchangedPageOne: true, screenshots: selected.screenshots.files, visualReview: 'pending native image review; structural assertions do not prove visual quality', modelRouting: 'separate live-session acceptance required' }
writeFileSync(join(dir, 'evidence.json'), JSON.stringify(record, null, 2))
console.log(JSON.stringify({ outputDirectory: dir, templates: templateEvidence.length, status: 'passed', screenshots: record.screenshots }))
