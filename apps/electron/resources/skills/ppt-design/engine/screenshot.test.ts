import { afterEach, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { captureSlides } from './screenshot.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function renderer() {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-capture-'))
  dirs.push(dir)
  const cli = join(dir, 'officecli')
  writeFileSync(cli, `#!${process.execPath}\nimport {appendFileSync,writeFileSync} from 'node:fs'; const args=process.argv.slice(2); appendFileSync(${JSON.stringify(join(dir, 'calls'))}, args[args.indexOf('--page')+1]+'\\n'); writeFileSync(args[args.indexOf('-o')+1], 'rendered');\n`)
  chmodSync(cli, 0o755)
  return { dir, cli }
}

test('affected-page capture preserves unrelated images and original page numbers', async () => {
  const { dir, cli } = renderer()
  writeFileSync(join(dir, 'slide-01.png'), 'unchanged')
  const result = await captureSlides(join(dir, 'deck.pptx'), dir, 5, { officecli: cli, pageNumbers: [4, 2, 2] })
  expect(result.available).toBe(true)
  expect(readFileSync(join(dir, 'calls'), 'utf8')).toBe('2\n4\n')
  expect(result.files).toEqual([join(dir, 'slide-02.png'), join(dir, 'slide-04.png')])
  expect(readFileSync(join(dir, 'slide-01.png'), 'utf8')).toBe('unchanged')
  expect(existsSync(join(dir, 'slide-03.png'))).toBe(false)
})

test('invalid or unknown affected pages fail before invoking a renderer', async () => {
  const { dir, cli } = renderer()
  for (const pages of [[], [0], [6], [1.5], [NaN]]) {
    expect((await captureSlides('deck.pptx', dir, 5, { officecli: cli, pageNumbers: pages })).available).toBe(false)
  }
  expect((await captureSlides('deck.pptx', dir, 0, { officecli: cli, pageNumbers: [1] })).available).toBe(false)
  expect(existsSync(join(dir, 'calls'))).toBe(false)
})

test('new-deck capture still covers every page', async () => {
  const { dir, cli } = renderer()
  expect((await captureSlides('deck.pptx', dir, 3, { officecli: cli })).files).toHaveLength(3)
  expect(readFileSync(join(dir, 'calls'), 'utf8')).toBe('1\n2\n3\n')
})

test('bundled CLI passes the affected-page list through to screenshot capture', async () => {
  const { dir, cli } = renderer()
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'deck-cli.mjs'), 'screenshot', join(dir, 'deck.pptx'), '--out', dir, '--pages', '5', '--only-pages', '2,4', '--officecli', cli], { stdout: 'pipe', stderr: 'pipe' })
  const body = JSON.parse(await new Response(child.stdout).text())
  expect(await child.exited).toBe(0)
  expect(body.screenshots.files).toEqual([join(dir, 'slide-02.png'), join(dir, 'slide-04.png')])
  expect(readFileSync(join(dir, 'calls'), 'utf8')).toBe('2\n4\n')
})
