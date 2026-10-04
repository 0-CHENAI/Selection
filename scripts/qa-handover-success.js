// ego-browser nodejs < scripts/qa-handover-success.js
// Reuse a task space with globalThis.handoverQA = { spaceId, url, outputDir }.
const { strict: assert } = await import('node:assert')
const { mkdir } = await import('node:fs/promises')
const config = globalThis.handoverQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Persistent handover chat bubble QA')
const page = task.page(config.page ?? 'p1')
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
const key = 'craft-skip-handover-confirmation'
const previous = await page.evaluate(key => localStorage.getItem(key), key)
const bubble = '[data-handover-message]'
async function reset() {
  await page.reload()
  await page.waitForSelector('[data-handover-trigger]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
    await (await import(url)).i18n.changeLanguage('zh-Hans')
    window.addEventListener('craft-agent-navigate', event => { window.lastHandoverRoute = event.detail.route })
  })
}
async function check(mode, screenshot) {
  await page.waitForSelector(bubble)
  const result = await page.evaluate(selector => {
    const wrapper = document.querySelector(selector), body = wrapper.querySelector('.bg-user-message-bubble')
    const r = body.getBoundingClientRect(), parent = wrapper.getBoundingClientRect()
    return { count: document.querySelectorAll(selector).length, text: body.textContent,
      mode: document.querySelector('[data-handover-session]').dataset.handoverMode,
      right: Math.abs(r.right - parent.right) < 1,
      fits: r.left >= parent.left && r.right <= parent.right,
      position: getComputedStyle(wrapper).position, time: !!wrapper.querySelector('time'),
      copy: !!wrapper.querySelector('button[aria-label="复制"]'),
      toast: !!document.querySelector('[data-sonner-toast][data-type="success"]'),
      dialog: !!document.querySelector('[role=dialog]') }
  }, bubble)
  assert.equal(result.count, 1, 'exactly one handover message belongs to each target')
  assert.equal(result.text, `已成功交接工作至${mode}`)
  assert.ok(result.mode === mode && !result.dialog)
  assert.ok(result.right && result.fits && result.position === 'static', 'use the user message bubble in the chat flow')
  assert.ok(result.time && result.copy && !result.toast, 'reuse timestamp and copy affordances without a success notification')
  if (screenshot) {
    const directory = config.outputDir ?? '/tmp/selection-handover-chat-bubble'
    await mkdir(directory, { recursive: true })
    const clip = await page.evaluate(() => {
      const r = document.querySelector('[data-handover-session]').getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    await page.screenshot({ path: `${directory}/${screenshot}.png`, clip })
  }
}
try {
  await page.evaluate(key => {
    localStorage.setItem(key, 'true')
    localStorage.setItem('playground-selected-component', 'session-handover')
  }, key)
  await reset()
  assert.equal(await page.evaluate(selector => !!document.querySelector(selector), bubble), false)
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
  assert.equal(await page.evaluate(selector => !!document.querySelector(selector), bubble), false, 'target loading is not success')
  await page.evaluate(() => window.releaseTargetLoad())
  // Deliberately wait past the old two-second expiry to verify permanent chat feedback.
  await page.waitForTimeout(2600)
  await check('PRO', 'handover-chat-bubble-dark')
  const target = await page.evaluate(() => ({ id: document.querySelector('[data-handover-session]').dataset.handoverSession, route: window.lastHandoverRoute }))
  await page.click('[data-handover-title-menu]')
  await page.click('text="打开源会话"')
  await page.waitForFunction(() => document.querySelector('[data-handover-session]').dataset.handoverSession === 'norm-analysis')
  assert.equal(await page.evaluate(selector => !!document.querySelector(selector), bubble), false, 'source history does not gain a target receipt')
  await page.evaluate(route => window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route } })), target.route)
  await page.waitForFunction(id => document.querySelector('[data-handover-session]').dataset.handoverSession === id, target.id)
  await check('PRO')
  await page.evaluate(() => window.dispatchEvent(new Event('selection-handover-updated')))
  await check('PRO')
  await reset()
  await page.selectOption('select', 'unknown')
  await check('PRO')
  await reset()
  await page.click('loc=role:button[name="Light"]')
  await page.click('[data-handover-trigger]')
  await check('PRO', 'handover-chat-bubble-light')
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'handover-qa-viewport'
    style.textContent = '[data-handover-session] { position: fixed; inset: 16px; height: calc(100dvh - 32px); z-index: 40; }'
    document.head.append(style)
  })
  await check('PRO', 'handover-chat-bubble-narrow')
  await page.evaluate(() => document.getElementById('handover-qa-viewport').remove())
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await reset()
  await page.click('[data-handover-trigger]')
  await check('PRO')
  await page.click('[data-handover-trigger]')
  await check('NORM')
  await reset()
  await page.selectOption('select', 'waiting')
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  assert.equal(await page.evaluate(selector => !!document.querySelector(selector), bubble), false, 'waiting is not success')
  await page.click('text="完成源任务（预览）"')
  await check('PRO')
  await reset()
  await page.evaluate(() => { window.electronAPI.sessionCommand = async () => { throw new Error('QA: 交接失败') } })
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog] [role=alert]')
  assert.equal(await page.evaluate(selector => !!document.querySelector(selector), bubble), false, 'failed creation must not announce success')
  await reset()
  await page.evaluate(() => { window.electronAPI.getSessionMessages = async () => null })
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog] [role=alert]')
  assert.equal(await page.evaluate(selector => !!document.querySelector(selector), bubble), false, 'failed loading must not announce success')
  console.log({ passed: true, permanentUserBubble: true, exactCopy: true, targetLoadedBeforeSuccess: true,
    returningAndHistoricalSessions: true, noDuplicate: true, timestampAndCopy: true,
    darkLightNarrow: true, reverseHandover: true, waitingAndFailures: true })
} catch (error) {
  console.error(await page.snapshot())
  throw error
} finally {
  await page.evaluate(() => document.getElementById('handover-qa-viewport')?.remove())
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await page.evaluate(({ key, previous }) => { if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous) }, { key, previous })
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
