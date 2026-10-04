// Start: bun x vite --config apps/electron/vite.config.ts --host 127.0.0.1 --port 5187 --strictPort
// Check: ego-browser nodejs < scripts/qa-handover-button.js
// To resume a space, prefix with globalThis.handoverQA = { spaceId, url, outputDir }.
const { strict: assert } = await import('node:assert')
const config = globalThis.handoverQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Handover button QA')
const page = task.page(config.page ?? 'p1')
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
const storageKey = 'craft-skip-handover-confirmation'
const previous = await page.evaluate(key => localStorage.getItem(key), storageKey)
try {
  await page.evaluate(key => { localStorage.setItem('playground-selected-component', 'session-handover'); localStorage.removeItem(key) }, storageKey)
  await page.reload()
  await page.waitForSelector('[data-handover-trigger]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
    if (!url) throw new Error('Vite i18n import missing')
    await (await import(url)).i18n.changeLanguage('zh-Hans')
  })
  const state = () => page.evaluate(() => {
    const button = document.querySelector('[data-handover-trigger]')
    return { target: button.textContent, source: document.querySelector('[data-handover-title]').textContent,
      disabled: button.disabled, dialog: !!document.querySelector('[role=dialog]'),
      records: document.querySelector('[data-handover-record-count]').textContent }
  })
  async function close() {
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  }
  async function capture(name) {
    const clip = await page.evaluate(async () => {
      const button = document.querySelector('[data-handover-trigger]')
      const animations = button.getAnimations({ subtree: true })
      for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement) animations.push(...ancestor.getAnimations())
      await Promise.all(animations.map(a => a.finished.catch(() => {})))
      const r = button.getBoundingClientRect()
      return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }
    })
    return page.screenshot({ path: `${config.outputDir ?? '/tmp/selection-handover-button'}/${name}.png`, clip })
  }
  assert.deepEqual(await state(), { target: 'PRO', source: '成本分析', disabled: false, dialog: false, records: '交接记录：0' })
  assert.ok(await page.evaluate(() => {
    const button = document.querySelector('[data-handover-trigger]'), r = button.getBoundingClientRect()
    return button.tagName === 'BUTTON' && button.getAttribute('aria-haspopup') === 'dialog'
      && button.getAttribute('aria-label') === '交接至 PRO' && button.firstElementChild.tagName.toLowerCase() === 'svg'
      && !document.querySelector('input[type=range]') && r.width < 80 && r.height >= 24
  }), 'one compact native action must replace the mode switch and slider')
  await page.click('loc=role:button[name="Light"]')
  const light = await capture('handover-button-pro-light')
  await page.hover('[data-handover-trigger]')
  await page.waitForSelector('[data-slot=tooltip-content]')
  assert.ok(await page.evaluate(() => document.querySelector('[data-slot=tooltip-content]').textContent.includes('交接至 PRO')))
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog]')
  assert.deepEqual(await state(), { target: 'PRO', source: '成本分析', disabled: true, dialog: true, records: '交接记录：0' }, 'opening review must preserve the source and require confirmation')
  await close()
  await page.focus('[data-handover-trigger]')
  assert.ok(await page.evaluate(() => { const button = document.querySelector('[data-handover-trigger]'); return button.matches(':focus-visible') && getComputedStyle(button).boxShadow !== 'none' }))
  await page.press('[data-handover-trigger]', 'Enter')
  await page.waitForSelector('[role=dialog]')
  await close()
  await page.press('[data-handover-trigger]', 'Space')
  await page.waitForSelector('[role=dialog]')
  await page.click('[role=dialog] button:text-is("交接到 PRO")')
  await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
  await page.waitForFunction(() => document.querySelector('[data-handover-trigger]').textContent === 'NORM' && !document.querySelector('[role=dialog]'))
  assert.equal((await state()).source, '成本核对', 'confirmation must open the PRO chat automatically')
  assert.equal(await page.evaluate(() => !!document.querySelector('[role=alert]')), false, 'confirmation must reach the existing handover transport')
  assert.deepEqual(await state(), { target: 'NORM', source: '成本核对', disabled: false, dialog: false, records: '交接记录：1' })
  await page.click('loc=role:button[name="Dark"]')
  const dark = await capture('handover-button-norm-dark')
  const point = await page.evaluate(() => { const r = document.querySelector('[data-handover-trigger]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
  await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForSelector('[role=dialog]')
  assert.equal((await state()).source, '成本核对')
  assert.equal((await state()).records, '交接记录：1')
  assert.equal(await page.evaluate(() => document.querySelector('[data-handover-trigger]').getAttribute('aria-label')), '交接至 NORM', 'the reverse action must describe the NORM handover')
  await close()
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
    const { i18n } = await import(url)
    for (const locale of ['zh-Hans', 'en', 'de', 'es', 'pl', 'hu', 'ja']) {
      await i18n.changeLanguage(locale)
      await new Promise(requestAnimationFrame)
      const label = document.querySelector('[data-handover-trigger]').getAttribute('aria-label')
      if (!label.includes('NORM') || label.includes('handover.openReview')) throw new Error(`Handover label missing in ${locale}`)
    }
    await i18n.changeLanguage('zh-Hans')
  })
  console.log({ passed: true, compact: true, iconThenTarget: true, noSlider: true, confirmationRequired: true, sourceModePreserved: true,
    automaticTargetNavigation: true, reverseHandover: true, keyboard: ['Enter', 'Space'], touch: true, locales: 7, screenshots: [light, dark] })
} finally {
  await page.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }, { key: storageKey, value: previous })
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
