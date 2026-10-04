// ego-browser nodejs < scripts/qa-handover-success.js
// Reuse a task space with globalThis.handoverQA = { spaceId, url, outputDir }.
const { strict: assert } = await import('node:assert')
const { mkdir, writeFile } = await import('node:fs/promises')
const config = globalThis.handoverQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Handover success alert QA')
const page = task.page(config.page ?? 'p1')
await page.cdp('Page.bringToFront')
const key = 'craft-skip-handover-confirmation'
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
const previous = await page.evaluate(key => localStorage.getItem(key), key)
const success = '[data-handover-success]'
// Trigger and measure the two-second feedback in the same browser task.
async function handover() { await page.evaluate(() => { window.handoverAlertCountBefore = window.handoverAlerts.length; document.querySelector('[data-handover-trigger]').click() }) }
async function reload() {
  await page.reload()
  await page.waitForSelector('[data-handover-trigger]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
    await (await import(url)).i18n.changeLanguage('zh-Hans')
    window.handoverAlerts = []
    let alert
    new MutationObserver(() => {
      const current = document.querySelector('[data-handover-success]')
      if (current && current !== alert) window.handoverAlerts.push({ start: performance.now(), text: current.textContent })
      if (!current && alert) window.handoverAlerts.at(-1).duration = performance.now() - window.handoverAlerts.at(-1).start
      alert = current
    }).observe(document.body, { childList: true, subtree: true })
    window.addEventListener('craft-agent-navigate', event => { window.lastHandoverRoute = event.detail.route })
  })
}
async function notice(name) {
  const geometry = await page.evaluate(async () => {
    document.querySelector('[data-handover-trigger]').click()
    const deadline = performance.now() + 2000
    let alert
    while (!(alert = document.querySelector('[data-handover-success]')) || Number(getComputedStyle(alert).opacity) < 0.98) {
      if (performance.now() > deadline) throw new Error('No visible success alert')
      await new Promise(requestAnimationFrame)
    }
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    const r = alert.getBoundingClientRect(), chat = document.querySelector('[data-handover-chat]').getBoundingClientRect()
    const outer = document.querySelector('[data-handover-session]').getBoundingClientRect()
    return { x: r.x + r.width / 2 - chat.x - chat.width / 2, y: r.y + r.height / 2 - chat.y - chat.height / 2,
      fits: r.left >= chat.left && r.right <= chat.right, viewportFits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      icon: !!alert.querySelector('svg circle'),
      role: alert.querySelector('[role=status]')?.getAttribute('aria-live'), pointerEvents: getComputedStyle(alert).pointerEvents,
      transform: getComputedStyle(alert).transform, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      clip: { x: outer.x, y: outer.y, width: outer.width, height: outer.height, scale: 1 } }
  })
  assert.ok(Math.abs(geometry.x) < 1 && Math.abs(geometry.y) < 1 && geometry.fits, 'success must be centered inside the chat')
  assert.ok(geometry.icon, 'the leading icon must contain a circled check')
  assert.equal(geometry.role, 'polite')
  assert.equal(geometry.pointerEvents, 'none', 'the success alert must not block the composer')
  if (geometry.reduced) { assert.equal(geometry.transform, 'none'); assert.ok(geometry.viewportFits, 'the narrow alert must fit the viewport') }
  // Capture the timed frame directly rather than waiting for animation stability.
  const shot = await page.cdp('Page.captureScreenshot', { format: 'png', clip: geometry.clip })
  const directory = config.outputDir ?? '/tmp/selection-handover-success'
  await mkdir(directory, { recursive: true })
  const path = `${directory}/${name}.png`
  await writeFile(path, Buffer.from(shot.data, 'base64'))
  return path
}
async function dismiss() {
  await page.waitForFunction(() => !document.querySelector('[data-handover-success]'))
  const duration = await page.evaluate(() => window.handoverAlerts.at(-1).duration)
  assert.ok(duration >= 1900 && duration < 2450, `success must last two seconds then fade out: ${duration}ms`)
  return duration
}
try {
  await page.evaluate(key => { localStorage.setItem(key, 'true'); localStorage.setItem('playground-selected-component', 'session-handover') }, key)
  await reload()
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-handover-success]')), false)
  await page.click('loc=role:button[name="Dark"]')
  const dark = await notice('handover-success-dark')
  assert.equal(await page.evaluate(() => window.handoverAlerts.at(-1).text), '已交接至 PRO')
  const darkDuration = await dismiss()
  assert.equal(await page.evaluate(() => document.querySelector('[data-handover-chat]').textContent.includes('已接收交接背景')), false, 'no permanent handover banner')
  await page.click('[data-handover-title-menu]')
  await page.click('text="查看交接"')
  await page.waitForSelector('[role=dialog]')
  assert.ok(await page.evaluate(() => document.querySelector('[role=dialog]').textContent.includes('交接背景与成果')))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  await page.click('loc=role:button[name="Light"]')
  const light = await notice('handover-success-light')
  await dismiss()
  const replay = await page.evaluate(async () => {
    const tick = () => new Promise(resolve => setTimeout(resolve, 10))
    document.querySelector('[data-handover-trigger]').click()
    const deadline = performance.now() + 2000
    while (!document.querySelector('[data-handover-success]')) { if (performance.now() > deadline) throw new Error('No fresh success alert'); await tick() }
    const start = performance.now(), route = window.lastHandoverRoute
    const targetId = document.querySelector('[data-handover-session]').dataset.handoverSession
    document.querySelector('[data-handover-title-menu]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }))
    let source
    while (!(source = [...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent === '打开源会话'))) { if (performance.now() > deadline) throw new Error('Source menu missing'); await tick() }
    source.click()
    while (document.querySelector('[data-handover-session]').dataset.handoverSession === targetId) { if (performance.now() > deadline) throw new Error('Source navigation did not render'); await tick() }
    const removed = !document.querySelector('[data-handover-success]')
    window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route } }))
    while (document.querySelector('[data-handover-session]').dataset.handoverSession !== targetId) { if (performance.now() > deadline) throw new Error('Target navigation did not render'); await tick() }
    return { removed, replayed: !!document.querySelector('[data-handover-success]'), elapsed: performance.now() - start }
  })
  assert.ok(replay.removed && !replay.replayed && replay.elapsed < 2000, `returning within two seconds must not replay a consumed notice: ${JSON.stringify(replay)}`)
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  // Let the chat fill the narrow viewport instead of the Playground's three-column shell.
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'handover-qa-viewport'
    style.textContent = '[data-handover-session] { position: fixed; inset: 16px; height: calc(100dvh - 32px); z-index: 40; }'
    document.head.append(style)
  })
  const narrow = await notice('handover-success-narrow')
  assert.ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
  const narrowDuration = await dismiss()
  await page.evaluate(() => document.getElementById('handover-qa-viewport').remove())
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await page.selectOption('select', 'unknown')
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-handover-success]')), false, 'historical handovers must not generate a success alert')
  await page.selectOption('select', 'compact')
  await handover()
  await page.waitForFunction(() => window.handoverAlerts.length > window.handoverAlertCountBefore)
  await dismiss()
  await page.click('[data-handover-title-menu]')
  await page.click('loc=role:button[name="查看交接"]')
  await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog]')].some(d => d.textContent.includes('交接背景与成果')))
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].some(d => d.textContent.includes('成本和风险各有依据'))), 'compact menu must keep handover details accessible')
  await page.keyboard.press('Escape')
  await page.selectOption('select', 'waiting')
  await handover()
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-handover-success]')), false, 'waiting is not success')
  await page.evaluate(() => { window.handoverAlertCountBefore = window.handoverAlerts.length; [...document.querySelectorAll('button')].find(b => b.textContent === '完成源任务（预览）').click() })
  await page.waitForFunction(() => window.handoverAlerts.length > window.handoverAlertCountBefore)
  await dismiss()
  await page.selectOption('select', 'ready')
  await page.evaluate(() => { window.electronAPI.sessionCommand = async () => { throw new Error('QA: 交接失败') } })
  await handover()
  await page.waitForSelector('[role=dialog] [role=alert]')
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-handover-success]')), false, 'failed creation must not announce success')
  console.log({ passed: true, centered: true, circledCheck: true, noPermanentBanner: true, noReplay: true, pointerTransparent: true,
    desktopAndCompactMenus: true, reducedMotion: true, waitingAndFailures: true, durations: [darkDuration, narrowDuration], screenshots: [dark, light, narrow] })
} catch (error) {
  console.error(await page.snapshot())
  throw error
} finally {
  await page.evaluate(() => document.getElementById('handover-qa-viewport')?.remove())
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
  await page.evaluate(({ key, previous }) => { if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous) }, { key, previous })
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
