// Run with Playwright installed in the runner. The actual initial index.html is
// tested while main.tsx is unavailable, before Tailwind can reset body margins.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const { chromium } = require('playwright')
let browser
;(async () => {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const base = process.env.BASE_URL || 'http://127.0.0.1:5184'
  const page = await browser.newPage()
  const shot = async name => {
    if (!process.env.SCREENSHOT_DIR) return
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` })
  }
  await page.route('**/main.tsx', route => route.abort())
  for (const [width, height] of [[980, 720], [320, 640], [2048, 1316]]) {
    await page.setViewportSize({ width, height })
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.locator('#_loader').waitFor()
    await page.waitForTimeout(750)
    const layout = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      bodyMargin: getComputedStyle(document.body).margin,
      loader: document.querySelector('#_loader').getBoundingClientRect().toJSON(),
    }))
    assert.equal(layout.scrollWidth, width)
    assert.equal(layout.scrollHeight, height)
    assert.equal(layout.bodyMargin, '0px')
    assert.equal(layout.loader.x, 0)
    assert.equal(layout.loader.y, 0)
    assert.equal(layout.loader.height, height)
    await page.mouse.wheel(0, 500)
    assert.equal(await page.evaluate(() => scrollY), 0)
    await shot(`loading-${width}`)
  }
  await page.close()

  const app = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  app.on('pageerror', error => errors.push(error.message))
  await app.goto(`${base}/components/app-shell/input/__tests__/fixtures/ppt-composer.html?shell=1&scroll=1`, { waitUntil: 'commit' })
  await app.getByRole('navigation', { name: 'Main navigation', exact: true }).waitFor({ timeout: 60000 })
  const id = await app.evaluate(async () => (await window.pptFixture.seedSession('NORM', 50)).id)
  await app.evaluate(id => window.pptFixture.configure({ id, ppt: false }), id)
  await app.getByTestId('ppt-picker-button').waitFor()
  await app.waitForTimeout(500)
  const messages = app.locator('[data-radix-scroll-area-viewport]').filter({ hasText: 'Message 50' }).last()
  await messages.waitFor()
  await messages.hover()
  const messageScroll = await messages.evaluate(element => ({ overflow: element.scrollHeight > element.clientHeight, top: element.scrollTop }))
  await app.mouse.wheel(0, messageScroll.top > 10 ? -300 : 300)
  await app.waitForTimeout(150)
  assert.ok(messageScroll.overflow && await messages.evaluate(element => element.scrollTop) !== messageScroll.top, 'wheel scrolls the conversation viewport')
  assert.equal(await app.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true)
  if (process.env.SCREENSHOT_DIR) await app.screenshot({ path: `${process.env.SCREENSHOT_DIR}/messages-scroll.png` })
  await app.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: /^PPT/ }).click()
  const card = app.getByTestId('ppt-template-scroll-template')
  await card.hover()
  await card.getByRole('button', { name: /Scrollable template/ }).last().click()
  await app.getByTestId('ppt-page-preview').waitFor()
  const detail = app.locator('[data-ppt-preview-scroll]')
  await detail.waitFor()
  await detail.hover()
  const detailScroll = await detail.evaluate(element => ({ overflow: element.scrollHeight > element.clientHeight, top: element.scrollTop }))
  await app.mouse.wheel(0, 250)
  await app.waitForTimeout(150)
  assert.ok(detailScroll.overflow && await detail.evaluate(element => element.scrollTop) > detailScroll.top, 'wheel scrolls the template detail viewport')
  assert.equal(await app.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true)
  if (process.env.SCREENSHOT_DIR) await app.screenshot({ path: `${process.env.SCREENSHOT_DIR}/template-scroll.png` })
  assert.deepEqual(errors, [])
  await browser.close()
  console.log('PASS: initial loader fits desktop/narrow/large viewports without body scroll; real conversation and PPT detail retain their own scrolling')
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1) })
