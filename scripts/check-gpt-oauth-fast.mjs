// Start Vite with apps/electron/vite.config.ts, then run:
// ego-browser nodejs < scripts/check-gpt-oauth-fast.mjs
import assert from 'node:assert/strict'
const task = await taskSpace('GPT OAuth Fast regression')
const page = task.page('p1')
const fast = '[data-testid="gpt-oauth-fast"]'
const model = 'button.input-toolbar-btn[aria-haspopup="menu"]'
async function checked() {
  return page.evaluate(() => document.querySelector('[data-testid="gpt-oauth-fast"]')?.getAttribute('aria-checked'))
}
try {
  await page.goto(`${process.env.BASE_URL || 'http://localhost:5190'}/components/app-shell/input/__tests__/fixtures/ppt-composer.html?fast=1`)
  await page.click(model)
  assert.equal(await checked(), 'false')
  await page.click(fast)
  assert.equal(await checked(), 'true')
  assert.equal(await page.evaluate(() => {
    const button = document.querySelector('[data-testid="gpt-oauth-fast"]')
    return !!button
      && button.getAttribute('role') === 'switch'
      && button.textContent.includes('Fast')
      && !button.closest('.prompt-effort-track')
      && !document.querySelector('.prompt-effort-shimmer')
      && !document.querySelector('.prompt-effort-pixel-grid')
      && getComputedStyle(button.querySelector('svg')).animationName === 'prompt-fast-charge'
  }), true, 'Fast is a lightning switch beside the unchanged effort slider')
  await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="gpt-oauth-fast"] svg')).animationName), 'none')
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
  await page.press(fast, 'Escape')
  await page.fill('[contenteditable="true"]', 'Fast verification')
  await page.click('button[aria-label="发送消息"]')
  const created = await page.evaluate(() => window.pptFixture.calls.creates[0])
  assert.equal(created.fastMode, true)
  assert.equal(created.thinkingLevel, 'medium')
  await page.evaluate(() => window.pptFixture.openCreated())
  await page.click(model)
  assert.equal(await checked(), 'true')
  const bounds = await page.evaluate(() => {
    const rect = document.querySelector('[role="slider"]').getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  await page.mouse.move(bounds.x + bounds.width - 12, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  assert.equal(await page.evaluate(() => document.querySelector('[role="slider"]').getAttribute('aria-valuetext')), '最大')
  assert.equal(await checked(), 'true', 'Changing effort must not change Fast')
  await page.press(fast, 'Escape')
  await page.evaluate(async () => {
    const other = await window.pptFixture.seedSession('NORM')
    window.pptFixture.configure({ id: other.id, ppt: false })
  })
  await page.click(model)
  assert.equal(await checked(), 'false', 'Another conversation must default off')
  await page.press(fast, 'Escape')
  await page.evaluate(() => window.pptFixture.configure({ id: 'created-1', ppt: false, compact: true }))
  await page.click('button[aria-label="模型: gpt-6.1-sol"]')
  assert.equal(await checked(), 'true', 'Compact picker must retain the conversation setting')
  await page.click(fast)
  assert.equal(await checked(), 'false')
  await page.evaluate(() => window.pptFixture.setProcessing('created-1', true))
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="gpt-oauth-fast"]')?.disabled), true)
  await page.evaluate(() => { window.pptFixture.setProcessing('created-1', false); window.pptFixture.setModel('created-1', 'gpt-4o') })
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="gpt-oauth-fast"]')?.disabled), true)
  assert.match(await page.evaluate(() => document.querySelector('[data-testid="gpt-oauth-fast"]')?.getAttribute('aria-description')), /不支持 Fast/)
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="gpt-oauth-fast"]')?.getAttribute('data-state')), 'unsupported')
  console.log('PASS: lightning switch, effort unchanged, reduced motion, default off, toggle, draft creation, session isolation, compact picker, busy and unsupported states')
} finally {
  await task.finish({ keep: [] })
}
