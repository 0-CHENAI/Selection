// ego-browser nodejs < scripts/qa-handover-success.js
// Reuse a task space with globalThis.handoverQA = { spaceId, url, outputDir }.
const { strict: assert } = await import('node:assert')
const { mkdir, writeFile } = await import('node:fs/promises')
const config = globalThis.handoverQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Handover success toast QA')
const page = task.page(config.page ?? 'p1')
await page.cdp('Page.bringToFront')
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
const key = 'craft-skip-handover-confirmation'
const previous = await page.evaluate(key => localStorage.getItem(key), key)
const success = '[data-sonner-toast][data-type="success"]'
const count = () => page.evaluate(() => window.handoverSuccessEvents.length)
async function reset() {
  await page.reload()
  await page.waitForSelector('[data-handover-trigger]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
    await (await import(url)).i18n.changeLanguage('zh-Hans')
    window.handoverSuccessEvents = []
    const seen = new WeakSet()
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('[data-sonner-toast][data-type="success"]')) {
        if (seen.has(toast)) continue
        seen.add(toast)
        window.handoverSuccessEvents.push({ text: toast.textContent, route: window.lastHandoverRoute })
      }
    }).observe(document.body, { childList: true, subtree: true })
    window.addEventListener('craft-agent-navigate', event => { window.lastHandoverRoute = event.detail.route })
  })
}
async function checkSuccess(mode, screenshot) {
  await page.waitForSelector(success)
  await page.waitForFunction(selector => {
    const toast = document.querySelector(selector), r = toast?.getBoundingClientRect()
    return toast?.dataset.mounted === 'true' && r.top >= 0 && Number(getComputedStyle(toast).opacity) > 0.98
  }, success)
  const data = await page.evaluate(selector => {
    const toast = document.querySelector(selector), r = toast.getBoundingClientRect()
    return { text: toast.querySelector('[data-title]').textContent,
      mode: document.querySelector('[data-handover-title-menu]').textContent,
      close: !!toast.querySelector('[data-close-button]'),
      position: [toast.dataset.xPosition, toast.dataset.yPosition],
      fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      oldAlert: !!document.querySelector('[data-handover-success]'),
      event: window.handoverSuccessEvents.at(-1) }
  }, success)
  assert.equal(data.text, `已成功交接工作至${mode}`)
  assert.ok(data.mode.startsWith(mode), 'success follows navigation to the loaded target')
  assert.ok(data.event.route.includes('/'), 'navigation must precede success')
  assert.deepEqual(data.position, ['right', 'top'])
  assert.ok(data.close && data.fits && !data.oldAlert, 'reuse the native notification bubble without the old centered alert')
  if (screenshot) {
    const shot = await page.cdp('Page.captureScreenshot', { format: 'png' })
    const directory = config.outputDir ?? '/tmp/selection-handover-success-toast'
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}/${screenshot}.png`, Buffer.from(shot.data, 'base64'))
  }
  // Sonner adds its shared exit transition after the two-second display duration.
  await page.mouse.move(0, 0)
  await page.waitForFunction(selector => !document.querySelector(selector), success, { timeout: 3500 })
}
try {
  await page.evaluate(key => {
    localStorage.setItem(key, 'true')
    localStorage.setItem('playground-selected-component', 'session-handover')
  }, key)
  await reset()
  await page.click('loc=role:button[name="Dark"]')
  await page.evaluate(() => {
    const original = window.electronAPI.getSessionMessages
    window.electronAPI.getSessionMessages = async id => {
      await new Promise(resolve => { window.releaseTargetLoad = resolve })
      return original(id)
    }
  })
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => typeof window.releaseTargetLoad === 'function')
  assert.equal(await count(), 0, 'loading a target is not yet success')
  await page.evaluate(() => window.releaseTargetLoad())
  await checkSuccess('PRO', 'handover-success-toast-dark')
  await page.evaluate(() => window.dispatchEvent(new Event('selection-handover-updated')))
  await page.click('[data-handover-title-menu]')
  await page.click('text="查看交接"')
  await page.waitForSelector('[role=dialog]')
  assert.equal(await count(), 1, 'refreshing or inspecting an existing handover must not repeat success')
  await page.keyboard.press('Escape')
  await reset()
  await page.click('loc=role:button[name="Light"]')
  await page.click('[data-handover-trigger]')
  await checkSuccess('PRO', 'handover-success-toast-light')
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'handover-qa-viewport'
    style.textContent = '[data-handover-session] { position: fixed; inset: 16px; height: calc(100dvh - 32px); z-index: 40; }'
    document.head.append(style)
  })
  await page.click('[data-handover-trigger]')
  await checkSuccess('NORM', 'handover-success-toast-narrow')
  await page.evaluate(() => document.getElementById('handover-qa-viewport').remove())
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await reset()
  await page.selectOption('select', 'waiting')
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  assert.equal(await count(), 0, 'waiting is not success')
  await page.click('text="完成源任务（预览）"')
  await checkSuccess('PRO')
  await reset()
  await page.evaluate(() => { window.electronAPI.sessionCommand = async () => { throw new Error('QA: 交接失败') } })
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog] [role=alert]')
  assert.equal(await count(), 0, 'failed creation must not announce success')
  await reset()
  await page.evaluate(() => { window.electronAPI.getSessionMessages = async () => null })
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog] [role=alert]')
  assert.equal(await count(), 0, 'failed target loading must not announce success')
  console.log({ passed: true, nativeToast: true, exactCopy: true, targetLoadedBeforeSuccess: true,
    noDuplicateSuccess: true, darkLightNarrow: true, reverseHandover: true, waitingAndFailures: true,
    screenshots: ['handover-success-toast-dark.png', 'handover-success-toast-light.png', 'handover-success-toast-narrow.png'] })
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
