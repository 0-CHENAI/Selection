// Start: bun x vite --config apps/electron/vite.config.ts --host 127.0.0.1 --port 5187 --strictPort
// Check: ego-browser nodejs < scripts/qa-handover-slider.js
// To resume a space, prefix the script with globalThis.handoverQA = { spaceId, url, outputDir }.
const { strict: assert } = await import('node:assert')
const config = globalThis.handoverQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Handover slider QA')
const page = task.page('p1')
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
await page.evaluate(() => localStorage.setItem('playground-selected-component', 'session-handover'))
await page.reload()
await page.waitForFunction(() => document.querySelector('input[type=range]') !== null)
await page.evaluate(async () => {
  const entry = await (await fetch('/playground.tsx')).text()
  const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
  if (!url) throw new Error('Vite i18n import missing')
  await (await import(url)).i18n.changeLanguage('zh-Hans')
})
const state = () => page.evaluate(() => {
  const input = document.querySelector('input[type=range]')
  return { value: Number(input.value), disabled: input.disabled,
    dialog: !!document.querySelector('[role=dialog]'), alert: document.querySelector('[role=alert]')?.textContent,
    records: document.querySelector('[data-handover-record-count]').textContent }
})
async function drag(mode, progress) {
  const r = await page.evaluate(() => {
    const input = document.querySelector('input[type=range]')
    const bounds = input.getBoundingClientRect()
    const thumb = input.parentElement.querySelector('span[style]').getBoundingClientRect()
    return { x: bounds.x, y: bounds.y + bounds.height / 2, width: bounds.width, thumbX: thumb.x, thumbWidth: thumb.width }
  })
  const start = r.thumbX + r.thumbWidth / 2
  const end = mode === 'NORM' ? r.x + r.width - r.thumbWidth / 2 : r.x + r.thumbWidth / 2
  await page.mouse.move(start, r.y)
  await page.mouse.down()
  await page.mouse.move(start + (end - start) * progress, r.y)
}
async function dismiss(start) {
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('[role=dialog]') === null)
  assert.equal((await state()).value, start, 'closing review must reset the source position')
}
async function capture(name) {
  const clip = await page.evaluate(() => {
    const r = document.querySelector('input[type=range]').parentElement.parentElement.getBoundingClientRect()
    return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }
  })
  return page.screenshot({ path: `${config.outputDir ?? '/tmp/selection-handover-slider'}/${name}.png`, clip })
}
assert.equal((await state()).records, '交接记录：0')
await page.click('loc=role:button[name="Light"]')
const light = await capture('handover-slider-norm-light')
await drag('NORM', 0.5)
assert.ok((await state()).value > 0 && (await state()).value < 100, 'native drag must move the thumb')
await page.mouse.up()
assert.deepEqual(await state(), { value: 0, disabled: false, dialog: false, records: '交接记录：0' })
await drag('NORM', 1)
assert.equal((await state()).value, 100)
await page.mouse.up()
await page.waitForSelector('[role=dialog]')
assert.deepEqual(await state(), { value: 0, disabled: true, dialog: true, records: '交接记录：0' })
await dismiss(0)
await page.focus('input[type=range]')
await page.press('input[type=range]', 'ArrowRight')
assert.equal((await state()).value, 1)
assert.ok(await page.evaluate(() => {
  const input = document.querySelector('input[type=range]')
  return input.matches(':focus-visible') && getComputedStyle(input.nextElementSibling).boxShadow !== 'none'
}), 'keyboard focus must remain visible over the transparent input')
await page.press('input[type=range]', 'Escape')
assert.equal((await state()).value, 0)
await page.press('input[type=range]', 'End')
await page.waitForSelector('[role=dialog]')
await dismiss(0)
await page.focus('input[type=range]')
await page.press('input[type=range]', 'Enter')
await page.waitForSelector('[role=dialog]')
await page.click('loc=role:button[name="交接到 PRO"]')
await page.waitForFunction(() => document.querySelector('[data-handover-record-count]').textContent === '交接记录：1')
assert.equal((await state()).alert, undefined, 'confirmation must reach the existing handover transport')
await dismiss(0)
await page.click('text="打开目标预览"')
await page.waitForFunction(() => document.querySelector('input[type=range]').value === '100')
await page.click('loc=role:button[name="Dark"]')
const dark = await capture('handover-slider-pro-dark')
await drag('PRO', 0.5)
await page.mouse.up()
assert.equal((await state()).value, 100)
assert.equal((await state()).dialog, false)
await drag('PRO', 1)
assert.equal((await state()).value, 0)
await page.mouse.up()
await page.waitForSelector('[role=dialog]')
assert.equal((await state()).records, '交接记录：1', 'reverse drag must not create a record before confirmation')
await dismiss(100)
await page.focus('input[type=range]')
await page.press('input[type=range]', 'Home')
await page.waitForSelector('[role=dialog]')
await dismiss(100)
await page.focus('input[type=range]')
await page.press('input[type=range]', 'Space')
await page.waitForSelector('[role=dialog]')
await dismiss(100)
await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('input[type=range]').parentElement.querySelector('span[style]')).transitionProperty), 'none')
await page.cdp('Emulation.setEmulatedMedia', { features: [] })
console.log({ passed: true, bidirectionalDrag: true, partialReset: true, confirmationRequired: true,
  keyboard: ['ArrowRight', 'Escape', 'End', 'Enter', 'Home', 'Space'], reducedMotion: true, screenshots: [light, dark] })
if (!config.spaceId) await task.finish({ keep: [] })
