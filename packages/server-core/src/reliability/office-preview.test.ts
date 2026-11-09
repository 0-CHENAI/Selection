import { afterEach, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import { zipSync, strToU8 } from 'fflate'
import { mkdirSync, writeFileSync } from 'node:fs'
import { OfficePreviewService, officeElement, officeNodes, officePreviewBytes, verifyOfficeSelection } from './office-preview'
import { OFFICE_PREVIEW_MAX_OPEN, OFFICE_PREVIEW_IDLE_TTL_MS, OFFICE_PREVIEW_MAX_SELECTION } from '@craft-agent/shared/protocol'

const exec = promisify(execFile)
const runtime = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
const resources: Array<{ service: OfficePreviewService; root: string }> = []
afterEach(async () => { for (const { service, root } of resources.splice(0)) { service.dispose(); await rm(root, { recursive: true, force: true }) } })

test('preview bytes follow a complete pptx and ignore a torn write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-preview-bytes-'))
  try {
    const file = join(root, 'deck.pptx')
    const snapshot = Buffer.from('snapshot')
    writeFileSync(file, Buffer.from('torn'))
    expect(officePreviewBytes(snapshot, file)).toBe(snapshot)
    const live = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types></Types>') }))
    writeFileSync(file, live)
    expect(officePreviewBytes(snapshot, file).equals(live)).toBe(true)
    expect(officePreviewBytes(live, file)).toBe(live)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Office element snapshots bound summaries and reject invalid paths', () => {
  expect(officeElement({ path: '/body/p[1]', type: 'paragraph', text: 'x'.repeat(5000) }).summary).toHaveLength(500)
  expect(() => officeElement({ path: 'selected', type: 'paragraph' })).toThrow()
})

test.skipIf(!runtime)('real OfficeCLI preview freezes selection, rejects drift and isolates sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-preview-test-'))
  const service = new OfficePreviewService(); resources.push({ service, root })
  const file = join(root, '含 空格.docx')
  const run = (...args: string[]) => exec(runtime!, args, { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' }, timeout: 30_000 })
  await run('create', file)
  await run('add', file, '/body', '--type', 'p', '--prop', 'text=Original paragraph')
  await run('close', file)
  const bytes = await readFile(file)
  const preview = await service.open('session', 'artifact', 'version', file, bytes)
  expect(preview.html).toContain('Original paragraph')
  await expect(service.capture('other-session', preview.previewId)).rejects.toThrow('过期')
  await expect(service.capture('session', preview.previewId)).rejects.toThrow('先选择')
  await service.select('session', preview.previewId, ['/body/p[1]'])
  const captured = (await service.capture('session', preview.previewId)).selection!
  expect(captured.elements[0]!.type).toBe('paragraph')
  expect(captured.elements[0]!.summary).toBe('Original paragraph')
  await expect(service.select('session', preview.previewId, Array.from({ length: OFFICE_PREVIEW_MAX_SELECTION + 1 }, (_, index) => `/body/p[${index + 1}]`))).rejects.toThrow('最多选择 256')
  expect((await service.capture('session', preview.previewId)).selection).toEqual(captured)
  service.assertCaptured('session', captured)
  const unchanged = await service.refresh('session', preview.previewId, bytes, 'version', false)
  expect(unchanged.previewId).toBe(preview.previewId)
  expect(unchanged.html).toBeUndefined()
  await expect(service.refresh('session', preview.previewId, Buffer.from('incomplete candidate'), 'version', true)).rejects.toThrow()
  expect(() => service.assertCaptured('session', captured)).not.toThrow()
  expect(() => service.assertCaptured('session', { ...captured, hash: '0'.repeat(64) })).toThrow('无效')
  await verifyOfficeSelection(file, captured)
  await expect(verifyOfficeSelection(file, { ...captured, elements: [{ ...captured.elements[0]!, digest: 'changed' }] })).rejects.toThrow('元素已变化')
  await writeFile(file, Buffer.concat([bytes, Buffer.from('external-change')]))
  await expect(service.capture('session', preview.previewId)).rejects.toThrow('文件已变化')
  await writeFile(file, bytes)
  await service.select('session', preview.previewId, [])
  expect(() => service.assertCaptured('session', captured)).not.toThrow()
  const child = (service as any).previews.get(preview.previewId).process
  const exited = new Promise(resolve => child.once('exit', resolve))
  await service.close('session', preview.previewId)
  await exited
  await expect(service.capture('session', preview.previewId)).rejects.toThrow('过期')
  const concurrent = await Promise.allSettled([
    service.open('session', 'artifact', 'version', file, bytes),
    service.open('session', 'artifact', 'version', file, bytes),
  ])
  expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((service as any).previews.size).toBe(1)
}, 60_000)

for (const kind of ['xlsx', 'pptx']) test.skipIf(!runtime)(`real ${kind} selections resolve to deterministic paths`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-selection-format-'))
  const service = new OfficePreviewService(); resources.push({ service, root })
  const file = join(root, `example.${kind}`)
  const run = (...args: string[]) => exec(runtime!, args, { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' }, timeout: 30_000 })
  await run('create', file)
  if (kind === 'xlsx') {
    await run('set', file, '/Sheet1/A1', '--prop', 'value=Example')
    await run('set', file, '/Sheet1/B1', '--prop', 'value=Second')
  } else {
    await run('add', file, '/', '--type', 'slide')
    await run('add', file, '/slide[1]', '--type', 'shape', '--prop', 'text=Example')
  }
  await run('close', file)
  const preview = await service.open('session', 'artifact', 'v1', file, await readFile(file))
  const paths = kind === 'xlsx' ? ['/Sheet1/A1', '/Sheet1/B1'] : ['/slide[1]/shape[1]']
  await service.select('session', preview.previewId, paths)
  const selection = (await service.capture('session', preview.previewId)).selection!
  expect(selection.elements).toHaveLength(paths.length)
  expect(selection.elements[0]!.path).toStartWith(kind === 'xlsx' ? '/Sheet1/' : '/slide[1]/shape[')
  await verifyOfficeSelection(file, selection)
}, 60_000)

test.skipIf(!runtime)('selecting a slide shape does not rewrite the pptx or its preview copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-preview-click-'))
  const service = new OfficePreviewService(); resources.push({ service, root })
  const file = join(root, 'deck.pptx')
  const run = (...args: string[]) => exec(runtime!, args, { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' }, timeout: 30_000 })
  await run('create', file)
  await run('add', file, '/', '--type', 'slide', '--prop', 'background=#0B1F33', '--prop', 'title=forkreduce')
  await run('add', file, '/slide[1]', '--type', 'shape', '--prop', 'text=本次讲什么', '--prop', 'x=80pt', '--prop', 'y=160pt', '--prop', 'w=400pt', '--prop', 'h=48pt')
  await run('close', file)
  const before = await readFile(file)
  const preview = await service.open('session', 'artifact', 'v1', file, before)
  expect(preview.html).toContain('forkreduce')
  expect(preview.html).toContain('本次讲什么')
  const watched = (service as any).previews.get(preview.previewId)
  const copyBefore = await readFile(watched.copy)
  const paths = [...preview.html!.matchAll(/data-path="(\/slide\[1\]\/shape(?:\[@id=\d+\]|\[\d+\]))"/g)].map(match => match[1]!)
  expect(paths.length).toBeGreaterThan(0)
  await service.select('session', preview.previewId, [paths[0]!])
  expect(Buffer.compare(await readFile(file), before)).toBe(0)
  expect(Buffer.compare(await readFile(watched.copy), copyBefore)).toBe(0)
  const html = await fetch(`http://127.0.0.1:${watched.port}/`).then(response => response.text())
  expect(html).toContain('forkreduce')
  expect(html).toContain('本次讲什么')
}, 60_000)

test.skipIf(!runtime)('real preview pool bounds startup/replacement processes, reuses suspended previews and evicts idle LRU', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-preview-budget-'))
  const service = new OfficePreviewService(); resources.push({ service, root })
  const file = join(root, 'pool.docx')
  const run = (...args: string[]) => exec(runtime!, args, { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' }, timeout: 30_000 })
  await run('create', file); await run('add', file, '/body', '--type', 'p', '--prop', 'text=Pool original'); await run('close', file)
  const bytes = await readFile(file), internal = service as any
  let peak = 0
  const spawned = new Map<number, any>()
  const sample = () => {
    const processes = [...internal.previews.values()].map((p: any) => p.process).concat([...internal.starting].map((p: any) => p.process)).filter(Boolean)
    for (const child of processes) if (child.pid) spawned.set(child.pid, child)
    peak = Math.max(peak, [...spawned.values()].filter(child => child.exitCode === null && child.signalCode === null).length)
  }
  const sampler = setInterval(sample, 5)
  try {
    const previews = await Promise.all(Array.from({ length: OFFICE_PREVIEW_MAX_OPEN }, (_, i) => service.open(`s${i}`, 'artifact', 'v1', file, bytes, false, true, `window-${i}`)))
    sample()
    expect(peak).toBe(5)
    await expect(service.open('sixth-active', 'artifact', 'v1', file, bytes, false, true, 'window-sixth')).rejects.toThrow('最多同时打开 5 个')
    expect(spawned.size).toBe(5)
    const first = internal.previews.get(previews[0]!.previewId), second = internal.previews.get(previews[1]!.previewId)
    const firstPid = first.process.pid
    service.suspend('s0', first.id, 'window-0')
    service.suspend('s1', second.id, 'window-1')
    expect(() => service.suspend('foreign', first.id, 'window-0')).toThrow('另一会话')
    second.touched = Date.now() - 1000
    const idleSince = second.touched
    service.suspend('s1', second.id, 'window-1')
    await expect(service.heartbeat('s1', second.id, 'window-1')).rejects.toThrow('休眠')
    expect(second.touched).toBe(idleSince)
    const resumed = await service.open('s0', 'artifact', 'v1', file, bytes, false, true, 'window-0', first.id)
    expect(resumed.previewId).toBe(first.id)
    expect(resumed.html).toBeUndefined()
    expect(internal.previews.get(first.id).process.pid).toBe(firstPid)
    const sixth = await service.open('sixth', 'artifact', 'v1', file, bytes, false, true, 'window-sixth')
    expect(internal.previews.has(second.id)).toBe(false)
    expect(second.process.exitCode !== null || second.process.signalCode !== null).toBe(true)
    expect(internal.previews.has(first.id)).toBe(true)
    expect(internal.previews.has(sixth.previewId)).toBe(true)
    // All five foreground leases are pinned. A new file must reuse this watch
    // process. Starting a sixth, even briefly, would pass the admission cap.
    await run('set', file, '/body/p[1]', '--prop', 'text=Pool changed'); await run('close', file)
    const old = internal.previews.get(previews[2]!.previewId)
    const oldPid = old.process.pid
    const updated = await service.refresh('s2', old.id, await readFile(file), 'v2', true, 'window-2')
    expect(updated.html).toContain('Pool changed')
    expect(updated.previewId).toBe(old.id)
    expect(old.process.pid).toBe(oldPid)
    expect(old.process.exitCode).toBe(null)
    expect(old.process.signalCode).toBe(null)
    sample()
    expect(peak).toBeLessThanOrEqual(5)
    expect(internal.previews.size).toBe(5)
    service.suspend('s0', first.id, 'window-0')
    first.touched = Date.now() - OFFICE_PREVIEW_IDLE_TTL_MS + 10_000
    await internal.prune()
    expect(internal.previews.has(first.id)).toBe(true)
    first.touched = Date.now() - OFFICE_PREVIEW_IDLE_TTL_MS
    await internal.prune()
    expect(internal.previews.has(first.id)).toBe(false)
    expect(first.process.exitCode !== null || first.process.signalCode !== null).toBe(true)
    expect(internal.previews.has(updated.previewId)).toBe(true)
    const shared = internal.previews.get(updated.previewId)
    await service.open('s2', 'artifact', 'v2', file, await readFile(file), true, true, 'another-window', updated.previewId)
    await service.close('s2', updated.previewId, 'window-2')
    expect(internal.previews.has(shared.id)).toBe(true)
    await service.close('s2', shared.id, 'another-window')
    expect(internal.previews.has(shared.id)).toBe(false)
  } finally { clearInterval(sampler) }
}, 90_000)

test.skipIf(!runtime)('preview deletion and disposal cancel startup reservations without leaking processes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-preview-startup-'))
  const service = new OfficePreviewService(); resources.push({ service, root })
  const file = join(root, 'startup.docx')
  await exec(runtime!, ['create', file], { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' }, timeout: 30_000 })
  const internal = service as any
  const opening = service.open('pending', 'artifact', 'v1', file, await readFile(file))
  void opening.catch(() => {})
  while (![...internal.starting].some((p: any) => p.process)) await new Promise(resolve => setTimeout(resolve, 5))
  const child = [...internal.starting].find((p: any) => p.process) as any
  await service.closeSession('pending')
  await expect(opening).rejects.toThrow()
  expect(child.process.exitCode !== null || child.process.signalCode !== null).toBe(true)
  expect(internal.starting.size).toBe(0)
  expect(internal.previews.size).toBe(0)
  service.dispose()
  await expect(service.open('after-exit', 'artifact', 'v1', file, await readFile(file))).rejects.toThrow('取消')
}, 60_000)

test.skipIf(!runtime)('a slide written during generation is in the same preview within a few seconds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-preview-live-'))
  const service = new OfficePreviewService(); resources.push({ service, root })
  const { watchPptDeck, exportIncrementalPptx, readPptProgress } = await import('../services/ppt-live')
  const { getPptSkillRoot } = await import('../services/ppt-catalog')
  const { pathToFileURL } = await import('node:url')
  const kit = await import(pathToFileURL(join(getPptSkillRoot(), 'styles/kit.ts')).href) as {
    fixtureTheme: unknown
    makeDeck: (title: string, theme: unknown, pages: unknown[]) => unknown
    makePage: (id: string, layout: string, name: string, background: string, elements: unknown[], notes: string) => unknown
    text: (id: string, value: string, x: number, y: number, w: number, h: number, size: number, opts?: { bold?: boolean }) => unknown
  }
  const page = (index: number) => kit.makePage(`p${index}`, 'free', `第${index}页`, '$paper', [
    kit.text('title-el', `第${index}页正文`, 48, 40, 400, 48, 24, { bold: true }),
  ], '')
  mkdirSync(join(root, 'data'), { recursive: true })
  const write = (count: number) => writeFileSync(join(root, 'data', 'deck.json'), JSON.stringify(kit.makeDeck('实时', kit.fixtureTheme, Array.from({ length: count }, (_, index) => page(index + 1)))))
  let chain = Promise.resolve()
  const watch = watchPptDeck(root, () => {
    chain = chain.catch(() => {}).then(() => exportIncrementalPptx(root)).then(() => undefined)
  }, 400)
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const waitForSlides = async (file: string, count: number, started: number) => {
    const deadline = started + 12_000
    let latest = Buffer.alloc(0)
    while (Date.now() < deadline) {
      await chain
      try { latest = await readFile(file) } catch { /* export has not renamed the package yet */ }
      if (latest.length > 100 && officePreviewBytes(Buffer.alloc(0), file).length > 100) {
        try {
          const { unzipSync } = await import('fflate')
          const names = Object.keys(unzipSync(latest)).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
          if (names.length >= count) return latest
        } catch { /* a renamed package can still be caught mid-write */ }
      }
      await sleep(50)
    }
    throw new Error(`slide ${count} was not exported`)
  }
  try {
    const firstMark = Date.now()
    write(1)
    let file = ''
    while (Date.now() - firstMark < 12_000) {
      await chain
      file = readPptProgress(root, true)?.pptxPath ?? ''
      if (file) break
      await sleep(50)
    }
    expect(file).not.toBe('')
    const firstBytes = await waitForSlides(file, 1, firstMark)
    const preview = await service.open('session', 'artifact', 'v1', file, firstBytes)
    const firstLatency = Date.now() - firstMark
    expect(preview.html).toContain('第1页正文')
    const watched = (service as any).previews.get(preview.previewId)
    const pid = watched.process.pid
    let selected: string | undefined
    try {
      const nodes = await officeNodes(file, '/slide[1]/shape[1]')
      selected = typeof nodes[0]?.path === 'string' ? nodes[0].path : undefined
      if (selected) await service.select('session', preview.previewId, [selected])
    } catch (error) { console.log('PPT_PREVIEW_SELECTION_SETUP', String(error)) }
    const nextMark = Date.now()
    write(2)
    const nextBytes = await waitForSlides(file, 2, nextMark)
    const visible = await service.refresh('session', preview.previewId, nextBytes, 'v2', false)
    const nextLatency = Date.now() - nextMark
    console.log(`PPT_PREVIEW_LATENCY_MS first=${firstLatency} next=${nextLatency} selected=${selected ?? 'none'}`)
    expect(visible.previewId).toBe(preview.previewId)
    expect(visible.html).toContain('第2页正文')
    // office_render reuses the panel HTML by hash; after a live refresh it must be the new page
    expect(service.htmlFor(file, createHash('sha256').update(nextBytes).digest('hex'))).toBe(visible.html)
    expect(watched.process.pid).toBe(pid)
    expect(watched.process.exitCode).toBe(null)
    expect(watched.process.signalCode).toBe(null)
    if (selected) expect(visible.selection?.elements.length).toBeGreaterThan(0)
    expect(nextLatency).toBeLessThan(8_000)
    expect(firstLatency).toBeLessThan(12_000)
    await expect(service.refresh('session', preview.previewId, Buffer.from('torn-zip'), 'v3', false)).rejects.toThrow('尚未写入完成')
    expect(watched.process.pid).toBe(pid)
    expect(watched.process.exitCode).toBe(null)
  } finally { watch.stop() }
}, 90_000)
