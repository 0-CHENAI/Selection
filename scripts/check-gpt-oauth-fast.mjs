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
      && !!button.closest('.prompt-effort-heading')
      && button.textContent.includes('Fast')
      && !document.querySelector('.prompt-effort-shimmer')
      && !document.querySelector('.prompt-effort-particles')
      && getComputedStyle(button.querySelector('svg')).animationName === 'prompt-fast-charge'
  }), true, 'Fast sits in the effort heading and medium effort has no particle field')
  const slider = '[role="slider"][aria-label="思考强度"]'
  const bounds = await page.evaluate(() => {
    const rect = document.querySelector('[role="slider"]').getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  await page.mouse.move(bounds.x + 11, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 11 + (bounds.width - 22) * 0.63, bounds.y + bounds.height / 2)
  assert.equal(await page.evaluate(() => document.querySelector('[role="slider"]').hasAttribute('data-dragging')), true)
  const draggingPosition = await page.evaluate(() => document.querySelector('[role="slider"]').style.getPropertyValue('--prompt-effort-x'))
  await page.mouse.up()
  assert.equal(await page.evaluate(() => document.querySelector('[role="slider"]').getAttribute('aria-valuenow')), '3')
  assert.notEqual(await page.evaluate(() => document.querySelector('[role="slider"]').style.getPropertyValue('--prompt-effort-x')), draggingPosition, 'Release must snap to the nearest stop')
  assert.equal(await checked(), 'true', 'Dragging effort must not change Fast')
  await page.press(slider, 'End')
  assert.equal(await page.evaluate(() => document.querySelector('[role="slider"]').getAttribute('aria-valuenow')), '4')
  assert.equal(await page.evaluate(() => {
    const field = document.querySelector('.prompt-effort-particles')
    return field?.getAttribute('data-mode') === 'max'
      && !!field.querySelector('.prompt-effort-particle-fallback')
      && document.querySelector('.prompt-effort-value')?.classList.contains('is-max')
  }), true, 'Max shows the particle field')
  await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="gpt-oauth-fast"] svg')).animationName), 'none')
  assert.equal(await page.evaluate(() => {
    const canvas = document.querySelector('.prompt-effort-particles canvas')
    return !canvas || getComputedStyle(canvas).display === 'none'
  }), true)
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
  await page.press(slider, 'Home')
  await page.press(slider, 'ArrowRight')
  assert.equal(await page.evaluate(() => document.querySelector('[role="slider"]').getAttribute('aria-valuenow')), '1')
  await page.press(fast, 'Escape')
  await page.fill('[contenteditable="true"]', 'Fast verification')
  await page.click('button[aria-label="发送消息"]')
  const created = await page.evaluate(() => window.pptFixture.calls.creates[0])
  assert.equal(created.fastMode, true)
  assert.equal(created.thinkingLevel, 'medium')
  await page.evaluate(() => window.pptFixture.openCreated())
  await page.click(model)
  assert.equal(await checked(), 'true')
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
  console.log('PASS: heading lightning, bottom shimmer, continuous drag and snap, keyboard, reduced motion, default off, toggle, draft creation, session isolation, compact picker, busy and unsupported states')
} finally {
  await task.finish({ keep: [] })
}
