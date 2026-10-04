// Run with ego-browser nodejs < scripts/qa-handover-preference.js.
// Reuse a task space with globalThis.handoverQA = { spaceId, url, outputDir }.
const { strict: assert } = await import('node:assert')
const config = globalThis.handoverQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Handover preference QA')
const page = task.page('p1')
const storageKey = 'craft-skip-handover-confirmation'
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
const previous = await page.evaluate(key => localStorage.getItem(key), storageKey)
async function reload() {
  await page.reload()
  await page.waitForSelector('[data-handover-trigger]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
    await (await import(url)).i18n.changeLanguage('zh-Hans')
  })
}
const state = () => page.evaluate(key => ({
  dialog: !!document.querySelector('[role=dialog]'),
  records: document.querySelector('[data-handover-record-count]').textContent,
  preference: localStorage.getItem(key),
  checked: document.querySelector('input[type=checkbox]')?.checked,
}), storageKey)
async function close() {
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
}
async function capture(name) {
  const clip = await page.evaluate(async () => {
    const dialog = document.querySelector('[role=dialog]')
    await Promise.all(dialog.getAnimations().map(a => a.finished.catch(() => {})))
    const r = dialog.getBoundingClientRect()
    return { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 24), width: Math.min(innerWidth, r.width + 48), height: Math.min(innerHeight, r.height + 48) }
  })
  return page.screenshot({ path: `${config.outputDir ?? '/tmp/selection-handover-preference'}/${name}.png`, clip })
}
try {
  await page.evaluate(key => { localStorage.removeItem(key); localStorage.setItem('playground-selected-component', 'session-handover') }, storageKey)
  await reload()
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('input[type=checkbox]')
  assert.equal((await state()).checked, false)
  await page.focus('input[type=checkbox]')
  await page.press('input[type=checkbox]', 'Space')
  assert.equal((await state()).checked, true, 'the native checkbox must be keyboard operable')
  await page.click('[role=dialog] button:text-is("取消")')
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  assert.equal((await state()).preference, null, 'cancel must not save the draft choice')
  assert.equal((await state()).records, '交接记录：0')
  await page.click('loc=role:button[name="Dark"]')
  await page.click('[data-handover-trigger]')
  assert.equal((await state()).checked, false, 'reopening must discard the cancelled draft')
  const dark = await capture('handover-dialog-dark')
  await close()
  await page.click('loc=role:button[name="Light"]')
  await page.click('[data-handover-trigger]')
  const light = await capture('handover-dialog-light')
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  const narrow = await capture('handover-dialog-narrow')
  assert.equal(await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return d.scrollWidth > d.clientWidth }), false)
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await page.click('input[type=checkbox]')
  await page.click('[role=dialog] button:text-is("交接到 PRO")')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  assert.equal((await state()).preference, 'true', 'confirmed opt-out must persist')
  assert.equal((await state()).checked, true, 'existing records must retain the preference control for new handovers')
  const results = await capture('handover-dialog-results')
  await close()
  await reload()
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  assert.equal((await state()).dialog, false, 'the saved preference must skip confirmation after reload')
  await page.waitForSelector('[data-sonner-toast]')
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].some(e => e.textContent.includes('打开目标会话'))), 'direct handover must offer a target action')
  await page.evaluate(() => {
    const original = window.electronAPI.sessionCommand
    window.handoverCreateCalls = 0
    window.electronAPI.sessionCommand = async (...args) => {
      if (args[1].operation?.type === 'create') {
        window.handoverCreateCalls++
        window.lastHandoverMode = args[1].operation.targetMode
        await new Promise(resolve => { window.releaseHandover = resolve })
      }
      return original(...args)
    }
  })
  await page.click('[data-handover-trigger]')
  assert.equal(await page.evaluate(() => document.querySelector('[data-handover-trigger]').disabled), true)
  await page.evaluate(() => document.querySelector('[data-handover-trigger]').click())
  assert.equal(await page.evaluate(() => window.handoverCreateCalls), 1, 'a busy direct action must not duplicate requests')
  await page.evaluate(() => window.releaseHandover())
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：2')
  assert.equal((await state()).dialog, false, 'later clicks must create fresh handovers without reopening confirmation')
  await page.click('text="打开目标预览"')
  await page.waitForFunction(() => document.querySelector('[data-handover-trigger]').textContent === 'NORM')
  await page.click('[data-handover-trigger]')
  assert.equal(await page.evaluate(() => window.lastHandoverMode), 'NORM', 'the same preference must support reverse handover')
  await page.evaluate(() => window.releaseHandover())
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：3')
  assert.equal((await state()).dialog, false)
  await reload()
  await page.selectOption('select', 'waiting')
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  assert.equal((await state()).dialog, false)
  await page.click('[data-sonner-toast] button:text-is("查看交接")')
  await page.waitForSelector('[role=dialog]')
  assert.ok(await page.evaluate(() => document.querySelector('[role=dialog]').textContent.includes('取消等待')), 'waiting must remain inspectable and cancellable')
  await close()
  await page.selectOption('select', 'ready')
  await page.evaluate(() => { window.electronAPI.sessionCommand = async () => { throw new Error('QA: 交接不可用') } })
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog] [role=alert]')
  assert.ok(await page.evaluate(() => document.querySelector('[role=alert]').textContent.includes('QA: 交接不可用')), 'failed direct actions must remain recoverable')
  assert.equal((await state()).preference, 'true')
  console.log({ passed: true, cancelDiscards: true, persisted: true, directHandover: true, duplicateGuard: true, reverseHandover: true, waitingInspectable: true, errorsVisible: true, screenshots: [dark, light, narrow, results] })
} finally {
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await page.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }, { key: storageKey, value: previous })
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
