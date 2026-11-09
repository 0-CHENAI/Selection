// Start Vite with apps/electron/vite.config.ts, then:
// ego-browser nodejs < scripts/check-ppt-result-menu.mjs
// BASE_URL defaults to http://localhost:5189. Host and revision sending are mocked.
import assert from 'node:assert/strict'
const task = await taskSpace('PPT result menu regression')
const page = task.page('p1')
const selector = id => `[data-testid="${id}"]`
const panel = selector('ppt-revision-panel')
const menu = selector('ppt-artifact-menu')
async function isOpen() {
  // Include the menu exit animation and focus restoration, not just the first frame.
  await new Promise(resolve => setTimeout(resolve, 400))
  return page.evaluate(() => !!document.querySelector('[data-testid="ppt-revision-panel"]'))
}
async function open(action) {
  await page.click(menu)
  await page.click(selector(`ppt-artifact-${action}`))
  assert.equal(await isOpen(), true, `${action} panel must remain open`)
}
try {
  await page.goto(`${process.env.BASE_URL || 'http://localhost:5189'}/playground.html?component=ppt-office-progress&variant=completed&frame=stage`)
  for (const [index, action] of ['restyle', 'recolor'].entries()) {
    await open(action)
    await page.click(selector('ppt-revision-option'))
    await page.click(selector('ppt-revision-apply'))
    assert.equal(await isOpen(), false)
    const result = await page.evaluate(() => {
      const output = document.querySelector('[data-testid="ppt-revision-result"]')
      return { count: output.dataset.count, revision: JSON.parse(output.textContent) }
    })
    assert.equal(result.count, String(index + 1), 'Apply must submit exactly once')
    assert.deepEqual(result.revision, action === 'restyle'
      ? { action, targets: [], templateId: 'paper' }
      : { action, targets: [], themeId: 'ink' })
  }
  await open('restyle')
  await page.press(selector('ppt-revision-tab-style'), 'Escape')
  assert.equal(await isOpen(), false)
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'ppt-artifact-menu')
  await page.press(menu, 'Enter')
  await page.press(selector('ppt-artifact-restyle'), 'Enter')
  assert.equal(await isOpen(), true, 'Keyboard must open the panel')
  await page.click(selector('ppt-revision-tab-color'))
  assert.equal(await isOpen(), true, 'Switching tabs must keep the panel open')
  await page.click(`${panel} > div:last-child > button:first-child`)
  assert.equal(await isOpen(), false, 'Cancel must dismiss')
  await open('recolor')
  await page.click('button[aria-label="复制"]')
  assert.equal(await isOpen(), false, 'Outside click must dismiss')
  await page.click(menu)
  await page.press(selector('ppt-artifact-restyle'), 'Escape')
  assert.equal(await isOpen(), false, 'Dismissing the menu must not open a stale panel')
  console.log('PASS: mouse, keyboard, restyle/recolor payloads, tab switch, Escape, cancel, outside click, menu dismissal')
} finally {
  await task.finish({ keep: [] })
}
