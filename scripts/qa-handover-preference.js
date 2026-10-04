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
  mode: document.querySelector('[data-handover-trigger]').parentElement.firstElementChild.textContent,
  sessionId: document.querySelector('[data-handover-session]').dataset.handoverSession,
}), storageKey)
async function waitForChat(mode) {
  await page.waitForFunction(mode => document.querySelector('[data-handover-trigger]').parentElement.firstElementChild.textContent.startsWith(mode)
    && !document.querySelector('[role=dialog]'), mode)
  assert.equal(await page.evaluate(() => !!document.querySelector('textarea[aria-label="消息"]')), true)
}
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
  await waitForChat('PRO')
  const proSession = (await state()).sessionId
  const chatClip = await page.evaluate(async () => {
    const chat = document.querySelector('[data-handover-session]')
    await Promise.all(chat.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {})))
    const r = chat.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  const results = await page.screenshot({ path: `${config.outputDir ?? '/tmp/selection-handover-preference'}/handover-chat-pro.png`, clip: chatClip })
  await page.click('text="查看交接"')
  await page.waitForSelector('[role=dialog]')
  assert.equal((await state()).sessionId, proSession, 'explicit detail inspection must not navigate away')
  await close()
  await page.click('text="打开源会话"')
  await waitForChat('NORM')
  assert.equal((await state()).sessionId, 'norm-analysis', 'the source chat must retain its NORM mode')
  await reload()
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  assert.equal((await state()).dialog, false, 'the saved preference must skip confirmation after reload')
  await waitForChat('PRO')
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
  await waitForChat('NORM')
  assert.equal(await page.evaluate(() => window.lastHandoverMode), 'NORM', 'the same preference must support reverse handover')
  await page.click('[data-handover-trigger]')
  assert.equal(await page.evaluate(() => window.lastHandoverMode), 'PRO')
  await page.evaluate(() => window.releaseHandover())
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：3')
  assert.equal((await state()).dialog, false)
  await waitForChat('PRO')
  await reload()
  await page.selectOption('select', 'waiting')
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  assert.equal((await state()).dialog, false)
  await page.click('[data-sonner-toast] button:text-is("查看交接")')
  await page.waitForSelector('[role=dialog]')
  assert.ok(await page.evaluate(() => document.querySelector('[role=dialog]').textContent.includes('取消等待')), 'waiting must remain inspectable and cancellable')
  await close()
  await page.evaluate(() => {
    const original = window.electronAPI.sessionCommand
    let held = false
    window.electronAPI.sessionCommand = async (...args) => {
      const result = await original(...args)
      if (args[1].operation?.type === 'get' && !held) {
        held = true
        await new Promise(resolve => { window.releaseWaitingPoll = resolve })
      }
      return result
    }
  })
  await page.waitForFunction(() => typeof window.releaseWaitingPoll === 'function')
  await page.click('text="完成源任务（预览）"')
  await page.evaluate(() => window.releaseWaitingPoll())
  await waitForChat('PRO')
  await reload()
  await page.selectOption('select', 'waiting')
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  await page.click('[data-sonner-toast] button:text-is("查看交接")')
  await page.waitForSelector('[role=dialog]')
  await page.click('[role=dialog] button:text-is("取消等待")')
  await page.waitForFunction(() => ![...document.querySelectorAll('[role=dialog] button')].some(button => button.textContent === '取消等待'))
  await close()
  assert.equal((await state()).mode, 'NORM · 成本分析', 'cancelled waits must not navigate')
  await page.selectOption('select', 'ready')
  await page.evaluate(() => { window.electronAPI.sessionCommand = async () => { throw new Error('QA: 交接不可用') } })
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog] [role=alert]')
  assert.ok(await page.evaluate(() => document.querySelector('[role=alert]').textContent.includes('QA: 交接不可用')), 'failed direct actions must remain recoverable')
  assert.equal((await state()).preference, 'true')
  assert.equal((await state()).mode, 'NORM · 成本分析', 'failed creation must retain the source chat')
  await close()
  await reload()
  await page.evaluate(() => {
    const original = window.electronAPI.getSessionMessages
    window.electronAPI.getSessionMessages = async id => {
      await new Promise(resolve => { window.releaseTargetLoad = resolve })
      return original(id)
    }
  })
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => typeof window.releaseTargetLoad === 'function')
  assert.equal((await state()).mode, 'NORM · 成本分析', 'navigation must wait for the target session to load')
  assert.equal(await page.evaluate(() => document.querySelector('[data-handover-trigger]').disabled), true)
  await page.evaluate(() => window.releaseTargetLoad())
  await waitForChat('PRO')
  await reload()
  await page.evaluate(() => {
    window.originalTargetLoad = window.electronAPI.getSessionMessages
    window.electronAPI.getSessionMessages = async () => null
  })
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog] [role=alert]')
  assert.equal((await state()).mode, 'NORM · 成本分析', 'failed target loading must remain recoverable in the source chat')
  assert.equal((await state()).records, '交接记录：1')
  await page.evaluate(() => { window.electronAPI.getSessionMessages = window.originalTargetLoad })
  await page.click('[role=dialog] button:text-is("交接到 PRO")')
  await waitForChat('PRO')
  assert.equal((await state()).records, '交接记录：1', 'load retry must reuse the existing handover')
  console.log({ passed: true, cancelDiscards: true, persisted: true, automaticTargetNavigation: true, sourceModePreserved: true,
    duplicateGuard: true, reverseHandover: true, waitingAutoNavigation: true, waitingCancellation: true, detailInspectionExplicit: true,
    errorsVisible: true, targetLoadBeforeNavigation: true, loadRetryIdempotent: true, screenshots: [dark, light, narrow, results] })
} finally {
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await page.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }, { key: storageKey, value: previous })
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
