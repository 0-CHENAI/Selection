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
  const r = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    await Promise.all(document.querySelector('[data-handover-control]').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
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
  // Capture the settled theme/hover state rather than a transition's first frame.
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    const root = document.querySelector('[data-handover-control]')
    const animations = root.getAnimations({ subtree: true })
    for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) animations.push(...ancestor.getAnimations())
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})))
  })
  const clip = await page.evaluate(() => {
    const r = document.querySelector('[data-handover-control]').getBoundingClientRect()
    return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }
  })
  return page.screenshot({ path: `${config.outputDir ?? '/tmp/selection-handover-slider'}/${name}.png`, clip })
}
assert.equal((await state()).records, '交接记录：0')
await page.click('loc=role:button[name="Light"]')
const light = await capture('handover-slider-norm-light')
const width = await page.evaluate(() => document.querySelector('[data-handover-control]').getBoundingClientRect().width)
assert.ok(width <= 116, 'both modes and the slider must fit one compact capsule')
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-handover-label]')).opacity), '0')
const hoverPoint = await page.evaluate(() => {
  const r = document.querySelector('[data-handover-thumb]').getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await page.mouse.move(hoverPoint.x, hoverPoint.y)
await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-handover-label]')).opacity === '1')
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-handover-mode]')).opacity), '0')
const hover = await capture('handover-slider-norm-hover')
assert.equal(await page.evaluate(() => document.querySelector('[data-handover-control]').getBoundingClientRect().width), width, 'hover must not shift the header layout')
await page.mouse.move(0, 0)
await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-handover-label]')).opacity === '0')
await drag('NORM', 0.5)
assert.ok((await state()).value > 0 && (await state()).value < 100, 'native drag must move the thumb')
assert.equal(await page.evaluate(() => document.querySelector('[data-handover-control]').dataset.mode), 'NORM')
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-handover-thumb]')).transitionProperty), 'none', 'dragging must follow the pointer without animation lag')
const moving = await capture('handover-slider-norm-drag')
await page.mouse.up()
assert.deepEqual(await state(), { value: 0, disabled: false, dialog: false, records: '交接记录：0' })
await drag('NORM', 1)
assert.equal((await state()).value, 100)
const armed = await capture('handover-slider-norm-armed')
await page.mouse.up()
await page.waitForSelector('[role=dialog]')
assert.deepEqual(await state(), { value: 0, disabled: true, dialog: true, records: '交接记录：0' })
await dismiss(0)
await page.focus('input[type=range]')
await page.press('input[type=range]', 'ArrowRight')
assert.equal((await state()).value, 1)
await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-handover-label]')).opacity === '1')
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
await page.click('[role=dialog] button:text-is("交接到 PRO")')
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
await page.mouse.move(0, 0)
await page.evaluate(() => document.activeElement.blur())
await page.evaluate(async () => {
  await new Promise(requestAnimationFrame)
  await Promise.all(document.querySelector('[data-handover-control]').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
})
const touchPoint = () => page.evaluate(() => {
  const thumb = document.querySelector('[data-handover-thumb]').getBoundingClientRect()
  const track = document.querySelector('input[type=range]').getBoundingClientRect()
  return { x: thumb.x + thumb.width / 2, y: thumb.y + thumb.height / 2, travel: track.width - thumb.width }
})
const touch = (type, point) => page.cdp('Input.dispatchTouchEvent', {
  type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [],
})
const point = await touchPoint()
await touch('touchStart', point)
await touch('touchMove', { x: point.x - point.travel / 2, y: point.y })
assert.ok((await state()).value > 0 && (await state()).value < 100)
await touch('touchCancel')
assert.equal((await state()).value, 100)
assert.equal((await state()).dialog, false)
await touch('touchStart', point)
await touch('touchMove', { x: point.x - point.travel, y: point.y })
assert.equal((await state()).value, 0)
await touch('touchEnd')
await page.waitForSelector('[role=dialog]')
assert.equal((await state()).records, '交接记录：1')
await dismiss(100)
await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('input[type=range]').parentElement.querySelector('span[style]')).transitionProperty), 'none')
assert.ok(await page.evaluate(() => ['[data-handover-mode]', '[data-handover-label]'].every(selector => getComputedStyle(document.querySelector(selector)).transitionProperty === 'none')))
await page.cdp('Emulation.setEmulatedMedia', { features: [] })
await page.evaluate(async () => {
  const entry = await (await fetch('/playground.tsx')).text()
  const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
  const { i18n } = await import(url)
  for (const locale of ['zh-Hans', 'en', 'de', 'es', 'pl', 'hu', 'ja']) {
    await i18n.changeLanguage(locale)
    await new Promise(requestAnimationFrame)
    const label = document.querySelector('[data-handover-label]')
    const range = document.createRange(); range.selectNodeContents(label)
    if (range.getBoundingClientRect().width > label.getBoundingClientRect().width - 4) throw new Error(`Handover label overflows in ${locale}`)
  }
  await i18n.changeLanguage('zh-Hans')
})
console.log(await page.snapshot())
console.log({ passed: true, bidirectionalDrag: true, partialReset: true, confirmationRequired: true,
  keyboard: ['ArrowRight', 'Escape', 'End', 'Enter', 'Home', 'Space'], reducedMotion: true,
  unified: true, width, touch: true, hoverReveal: true, stableWidth: true, locales: 7, screenshots: [light, hover, moving, armed, dark] })
if (!config.spaceId) await task.finish({ keep: [] })
