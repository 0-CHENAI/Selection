import { afterEach, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

test('full fallback capture does not count stale images from the output directory', async () => {
  const { dir } = renderer()
  const pdftoppm = join(dir, 'pdftoppm')
  writeFileSync(pdftoppm, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(process.argv.at(-1)+'-1.png', 'new');\n`)
  const libreoffice = join(dir, 'soffice')
  writeFileSync(libreoffice, `#!${process.execPath}\nprocess.exit(0);\n`)
  chmodSync(pdftoppm, 0o755)
  chmodSync(libreoffice, 0o755)
  writeFileSync(join(dir, 'slide-02.png'), 'stale')
  const result = await captureSlides(join(dir, 'deck.pptx'), dir, 2, { officecli: '', libreoffice, pdftoppm })
  expect(result.available).toBe(false)
  expect(result.files).toEqual([join(dir, 'slide-1.png')])
  expect(readFileSync(join(dir, 'slide-02.png'), 'utf8')).toBe('stale')
})

test('bundled CLI passes the affected-page list through to screenshot capture', async () => {
  const { dir, cli } = renderer()
  writeFileSync(join(dir, 'deck.pptx'), 'saved deck bytes')
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'deck-cli.mjs'), 'screenshot', join(dir, 'deck.pptx'), '--out', dir, '--pages', '5', '--only-pages', '2,4', '--officecli', cli], { stdout: 'pipe', stderr: 'pipe' })
  const body = JSON.parse(await new Response(child.stdout).text())
  expect(await child.exited).toBe(0)
  expect(body.screenshots.files).toEqual([join(dir, 'slide-02.png'), join(dir, 'slide-04.png')])
  expect(body.pptVisualRender.pages.map((page: {page: number}) => page.page)).toEqual([2, 4])
  expect(readFileSync(join(dir, 'calls'), 'utf8')).toBe('2\n4\n')
})

test('bundled CLI persists independent evidence for each successful screenshot batch', async () => {
  const { dir, cli } = renderer()
  const file = join(dir, 'deck.pptx')
  const session = join(dir, 'session')
  const receipts = join(session, 'data', 'ppt-visual-renders')
  writeFileSync(file, 'saved deck bytes')
  for (const page of [2, 4]) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'deck-cli.mjs'), 'screenshot', file,
      '--out', dir, '--pages', '5', '--only-pages', String(page), '--officecli', cli],
    { env: { ...process.env, CRAFT_SESSION_DIR: session }, stdout: 'pipe', stderr: 'pipe' })
    const body = JSON.parse(await new Response(child.stdout).text())
    expect(await child.exited).toBe(0)
    expect(readdirSync(receipts).some(name => readFileSync(join(receipts, name), 'utf8') === JSON.stringify(body.pptVisualRender))).toBe(true)
  }
  expect(readdirSync(receipts)).toHaveLength(2)
})

test('bundled CLI renders each saved revision at a path isolated from OfficeCLI residents', async () => {
  const { dir, cli } = renderer()
  const file = join(dir, 'deck.pptx')
  writeFileSync(cli, `#!${process.execPath}\nimport {readFileSync,writeFileSync} from 'node:fs'; const source=process.argv[3]; writeFileSync(process.argv.at(-1), JSON.stringify({source, bytes:readFileSync(source,'utf8'), noAuto:process.env.OFFICECLI_NO_AUTO_RESIDENT}));\n`)
  const sources = []
  for (const bytes of ['original revision', 'edited revision']) {
    writeFileSync(file, bytes)
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'deck-cli.mjs'), 'screenshot', file,
      '--out', dir, '--pages', '1', '--officecli', cli], { stdout: 'pipe', stderr: 'pipe' })
    const body = JSON.parse(await new Response(child.stdout).text())
    expect(await child.exited).toBe(0)
    const png = JSON.parse(readFileSync(body.screenshots.files[0], 'utf8'))
    expect(png.bytes).toBe(bytes)
    expect(png.noAuto).toBe('1')
    expect(png.source).not.toBe(file)
    expect(existsSync(png.source)).toBe(false)
    expect(body.pptVisualRender.path).toBe(realpathSync(file))
    sources.push(png.source)
  }
  expect(new Set(sources).size).toBe(2)
})
