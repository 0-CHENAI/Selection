/* Diagnose the real AppShell sidebar and composer together; host IPC is stubbed.
 * Start Vite using apps/electron/vite.config.ts. The script never calls a model.
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
  await page.addInitScript(() => {
    // These are isolated browser-test preferences, never the user's files.
    const collapsed = JSON.stringify(['nav:ppt', 'nav:sources', 'nav:automations'])
    localStorage.setItem('craft-collapsed-sidebar-items', collapsed)
    localStorage.setItem('craft-collapsed-sidebar-items:playground-workspace', collapsed)
  })
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:5183'}/components/app-shell/input/__tests__/fixtures/ppt-composer.html?shell=1`, { waitUntil: 'commit' })
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true })
  const entry = () => nav.getByRole('button', { name: /^PPT/ })
  const picker = () => page.getByTestId('ppt-picker-button')
  const shot = async name => {
    if (!process.env.SCREENSHOT_DIR) return
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` })
  }
  const checkOrdinary = async () => {
    await picker().waitFor()
    assert.equal(await entry().count(), 1)
    assert.equal(await picker().count(), 1)
    assert.equal(await entry().isVisible(), true)
    assert.equal(await picker().isVisible(), true)
  }
  await nav.waitFor()
  await checkOrdinary()
  assert.equal(await page.getByRole('button', { name: 'NORM', exact: true }).getAttribute('aria-pressed'), 'true')
  await shot('norm')

  const id = await page.evaluate(async () => (await window.pptFixture.seedSession('NORM')).id)
  await page.evaluate(id => window.pptFixture.configure({ id, ppt: false, mode: 'NORM' }), id)
  await checkOrdinary()
  await shot('norm-existing')
  await nav.getByRole('button', { name: 'Redundant', exact: true }).click()
  await checkOrdinary()
  await shot('norm-project')

  await entry().click()
  await page.getByTestId('ppt-home-gallery').waitFor()
  assert.equal(await entry().count(), 1)
  assert.equal(await picker().count(), 0)
  assert.equal(await page.locator('.session-mode-badge').count(), 0)
  await shot('ppt')

  await nav.getByRole('button', { name: /普通会话/ }).click()
  await checkOrdinary()
  await picker().click()
  await page.getByTestId('ppt-picker-popover').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'PRO', exact: true }).click()
  await page.locator('.session-mode-badge').waitFor()
  await checkOrdinary()
  await shot('pro')
  await page.getByRole('button', { name: 'NORM', exact: true }).click()
  await checkOrdinary()
  assert.equal(await page.locator('.session-mode-badge').count(), 0)
  assert.deepEqual(errors, [])
  await browser.close()
  console.log('PASS: real AppShell and ChatPage retain PPT sidebar/composer entries in NORM drafts, existing NORM, project NORM, PRO, PPT and return navigation; legacy collapsed preferences do not hide PPT; no runtime errors')
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1) })
