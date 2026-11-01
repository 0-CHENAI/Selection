/* Office home: PPT | Word | Excel must be clickable and the PPT gallery must not fold
 * cards behind 更多模板. Real AppShell with a stubbed host bridge; never calls a model.
 * Start Vite with apps/electron/vite.config.ts, then run with Playwright installed.
 * BASE_URL defaults to :5183; CHROMIUM_PATH and SCREENSHOT_DIR are optional.
 */
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const { chromium } = require('playwright')
let browser
;(async () => {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shot = async name => {
    if (!process.env.SCREENSHOT_DIR) return
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` })
  }
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:5183'}/components/app-shell/input/__tests__/fixtures/ppt-composer.html?shell=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.pptFixture)
  await page.evaluate(() => window.pptFixture.configure({ ppt: true, mode: 'PRO' }))
  const heading = () => page.locator('[data-testid=ppt-home-hero] h1, [data-testid=office-home-hero] h1').first().innerText()
  await page.getByTestId('ppt-template-gallery').waitFor()
  assert.equal(await page.getByTestId('ppt-more-templates').count(), 0)
  // Nothing may sit on top of the switch: the button itself must receive the click.
  for (const mode of ['word', 'excel', 'ppt']) {
    const button = page.getByTestId(`office-mode-${mode}`)
    const box = await button.boundingBox()
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid^="office-mode-"]')?.getAttribute('data-testid') ?? null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    assert.equal(hit, `office-mode-${mode}`)
  }
  await shot('office-ppt')
  await page.getByTestId('office-mode-word').click({ timeout: 5000 })
  await page.getByTestId('office-case-gallery-word').waitFor({ timeout: 5000 })
  assert.match(await heading(), /Word/)
  assert.equal(await page.getByTestId('office-mode-word').getAttribute('aria-checked'), 'true')
  await shot('office-word')
  await page.getByTestId('office-mode-excel').click({ timeout: 5000 })
  await page.getByTestId('office-case-gallery-excel').waitFor({ timeout: 5000 })
  assert.match(await heading(), /Excel/)
  await shot('office-excel')
  await page.getByTestId('office-mode-ppt').click({ timeout: 5000 })
  await page.getByTestId('ppt-template-gallery').waitFor({ timeout: 5000 })
  assert.match(await heading(), /PPT/)
  assert.deepEqual(errors, [])
  console.log('office mode switch: PPT → Word → Excel → PPT ok')
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => browser?.close())
