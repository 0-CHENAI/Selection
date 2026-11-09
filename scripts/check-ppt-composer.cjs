/* Real ChatPage regression with a stubbed host bridge. Start Vite with
 * apps/electron/vite.config.ts, then run with Playwright installed in the runner.
 * BASE_URL defaults to :5183; CHROMIUM_PATH and SCREENSHOT_DIR are optional.
 */
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const { chromium } = require('playwright')
let browser

;(async () => {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const screenshot = async name => {
    if (!process.env.SCREENSHOT_DIR) return
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` })
  }
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:5183'}/components/app-shell/input/__tests__/fixtures/ppt-composer.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.pptFixture)
  const configure = async options => {
    await page.evaluate(options => window.pptFixture.configure(options), options)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  const picker = () => page.locator('.working-directory-control > button').first()
  const clear = () => page.locator('.working-directory-control-clear')
  const clearDirectory = async () => { await picker().hover(); await clear().click() }
  const sources = () => page.locator('[data-tutorial="source-selector-button"]')
  const calls = () => page.evaluate(() => structuredClone(window.pptFixture.calls))
  const noRedundantLabels = async () => {
    assert.equal(await page.getByTestId('ppt-picker-button').count(), 0)
    assert.equal(await page.locator('.session-mode-badge').count(), 0)
  }
  const toggleFirstSource = async () => {
    await sources().click()
    await page.locator('[data-tutorial="source-dropdown-item-first"]').click()
    await page.locator('.z-floating-backdrop').click({ position: { x: 5, y: 5 } })
  }
  const send = async text => {
    await page.locator('[contenteditable="true"]').fill(text)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.waitForFunction(() => window.pptFixture.calls.creates.length > 0)
  }
  await picker().waitFor()
  await noRedundantLabels()
  assert.equal(await sources().count(), 1)
  await screenshot('after')

  await page.getByTestId('ppt-template-select').click()
  await page.getByTestId('ppt-selected-template').waitFor()
  await toggleFirstSource()
  await picker().click()
  await clear().waitFor()
  await screenshot('selected')
  await send('请用选中的资料制作演示文稿')
  await page.waitForFunction(() => window.pptFixture.calls.sends.length === 1)
  const first = await calls()
  assert.deepEqual(first.creates[0].enabledSourceSlugs, ['github-api'])
  assert.equal(first.creates[0].workingDirectory, '/work/ppt-input')
  assert.equal(first.creates[0].workMode, 'PRO')
  assert.equal(first.creates[0].ppt.templateId, 'fixture-template')
  assert.ok(first.sends[0][3].includes('ppt-design'))
  assert.equal(first.sends[0][6].templateId, 'fixture-template')

  await page.evaluate(() => window.pptFixture.openCreated())
  await page.getByRole('button', { name: '选择工作目录: /work/ppt-input', exact: true }).waitFor()
  await noRedundantLabels()
  await screenshot('existing')
  await clearDirectory()
  await page.waitForFunction(() => window.pptFixture.calls.commands.length > 0)
  assert.deepEqual((await calls()).commands.at(-1), ['created-1', { type: 'updateWorkingDirectory', dir: '/sessions/created-1' }])
  assert.equal(await clear().count(), 0)
  await toggleFirstSource()
  assert.equal(await sources().getAttribute('aria-label'), '选择数据源')
  await send('继续完善这份 PPT')
  await page.waitForFunction(() => window.pptFixture.calls.sends.length === 2)
  assert.equal((await calls()).sends[1][0], 'created-1')
  assert.ok((await calls()).sends[1][3].includes('ppt-design'))

  await configure({})
  await page.getByTestId('ppt-home-gallery').waitFor()
  assert.equal(await clear().count(), 0, 'new standalone draft must not inherit the directory')
  assert.equal(await sources().getAttribute('aria-label'), '选择数据源', 'new standalone draft must not inherit sources')
  await picker().click()
  await clear().waitFor()
  await clearDirectory()
  assert.equal(await clear().count(), 0, 'draft directory is clearable')
  await screenshot('new-isolated')
  await send('新会话不使用前一会话的资料和目录')
  await page.waitForFunction(() => window.pptFixture.calls.creates.length === 2)
  const second = (await calls()).creates[1]
  assert.deepEqual(second.enabledSourceSlugs, [])
  assert.equal(second.workingDirectory, 'none')
  assert.equal(second.workMode, 'PRO')

  await page.setViewportSize({ width: 480, height: 820 })
  await screenshot('narrow')
  for (const control of [picker(), sources(), page.getByRole('button', { name: '发送消息', exact: true })]) {
    const rect = await control.boundingBox()
    assert.ok(rect && rect.width >= 20 && rect.x >= 0 && rect.x + rect.width <= 480, 'controls stay reachable in a narrow desktop window')
  }
  await configure({ compact: true })
  await picker().waitFor()
  await noRedundantLabels()
  await screenshot('compact')
  await picker().click()
  await clear().waitFor()
  await clearDirectory()
  assert.equal(await clear().count(), 0)

  await configure({ project: 'project' })
  await page.getByRole('note', { name: /\/project\/fixed/ }).waitFor()
  assert.equal(await picker().count(), 0)
  assert.equal(await clear().count(), 0)
  await screenshot('project')

  await configure({ ppt: false })
  await page.getByTestId('ppt-picker-button').waitFor()
  assert.equal(await sources().count(), 1, 'ordinary chat keeps its source selector')
  assert.equal(await picker().count(), 1)
  await configure({ ppt: false, mode: 'PRO' })
  await page.locator('.session-mode-badge').waitFor()
  assert.equal(await page.getByTestId('ppt-picker-button').count(), 1, 'ordinary PRO chat retains both meaningful controls')
  assert.deepEqual(errors, [])
  await browser.close()
  console.log('PASS: real ChatPage PPT labels, sources, directory, creation/send PRO and skill/template parameters, existing session updates, clear, new draft isolation, narrow/compact, project binding, ordinary chat entry; no browser runtime errors')
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1) })
