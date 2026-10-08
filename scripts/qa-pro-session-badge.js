// ego-browser nodejs < scripts/qa-pro-session-badge.js
// Resume the same space with globalThis.badgeQA = { spaceId, outputDir }.
const { strict: assert } = await import('node:assert')
const { mkdir } = await import('node:fs/promises')
const config = globalThis.badgeQA ?? {}
const task = await taskSpace(config.spaceId ?? 'PRO composer badge QA')
const page = task.page('p1')
const directory = config.outputDir ?? '/tmp/selection-pro-composer-badge'
await mkdir(directory, { recursive: true })
await page.goto('http://127.0.0.1:5187/playground.html')
const previous = await page.evaluate(async () => {
  const entry = await (await fetch('/playground.tsx')).text()
  const url = [...entry.matchAll(/from "([^"]+)"/g)].map(match => match[1]).find(url => url.includes('/i18n/'))
  const { i18n } = await import(url)
  const language = i18n.language
  await i18n.changeLanguage('zh-Hans')
  return { component: localStorage.getItem('playground-selected-component'), theme: localStorage.getItem('craft-theme'), language, i18nUrl: url }
})
const badgeSelector = '[data-work-mode-chat] form .session-mode-badge'
async function switchMode(mode) {
  await page.click(`loc=role:button[name="${mode}"]`)
  await page.waitForFunction(mode => document.documentElement.dataset.workMode === mode && !document.documentElement.dataset.workModeTransitionPhase, mode)
}
async function theme(name) {
  await page.click(`loc=role:button[name="${name}"]`)
  await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, name === 'Dark')
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await Promise.allSettled(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished))
  })
}
async function capture(name, selector) {
  const clip = await page.evaluate(selector => {
    const r = document.querySelector(selector).getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }, selector)
  await page.screenshot({ path: `${directory}/${name}.png`, clip })
}
async function checkBadge() {
  const result = await page.evaluate(selector => {
    const chat = document.querySelector('[data-work-mode-chat]'), badge = chat.querySelector(selector), form = badge.closest('form')
    const style = getComputedStyle(badge), bounds = badge.getBoundingClientRect(), formBounds = form.getBoundingClientRect()
    const folder = form.querySelector('button[aria-label="在文件夹中工作"], button[aria-label="选择工作目录"]')
    const folderBounds = folder?.getBoundingClientRect()
    const icons = [...form.querySelectorAll('.input-toolbar-btn > span:first-child svg')].map(icon => icon.getBoundingClientRect())
    let folderVisibleRight = folderBounds?.right
    for (let parent = folder?.parentElement; parent && parent !== form; parent = parent.parentElement) {
      if (['hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) {
        folderVisibleRight = Math.min(folderVisibleRight, parent.getBoundingClientRect().right)
      }
    }
    return { count: chat.querySelectorAll('.session-mode-badge').length, outside: document.querySelectorAll('[data-work-mode-list] .session-mode-badge, [data-work-mode-chat] h1 .session-mode-badge').length,
      label: badge.textContent.trim(), accessibleLabel: badge.getAttribute('aria-label'), tabIndex: badge.tabIndex,
      height: bounds.height, background: style.backgroundColor, color: style.color, borderColor: style.borderColor,
      afterFolder: !!folderBounds && bounds.left >= folderVisibleRight, sameRow: !!folderBounds && Math.abs((bounds.top + bounds.bottom) / 2 - (folderBounds.top + folderBounds.bottom) / 2) < 1,
      iconsFit: icons.every((icon, index) => index === 0 || icon.left >= icons[index - 1].right),
      fits: bounds.right < formBounds.right && bounds.left >= formBounds.left && form.scrollWidth <= form.clientWidth }
  }, badgeSelector)
  assert.equal(result.count, 1)
  assert.equal(result.outside, 0)
  assert.equal(result.label, 'PRO')
  assert.equal(result.accessibleLabel, '当前处于 PRO 模式')
  assert.equal(result.tabIndex, 0)
  assert.ok(result.height >= 18 && result.height <= 20)
  assert.equal(result.background, 'rgba(0, 0, 0, 0)')
  assert.equal(result.color, result.borderColor)
  assert.ok(result.afterFolder && result.sameRow && result.fits && result.iconsFit, JSON.stringify(result))
  return result.color
}
try {
  await page.click('loc=role:button[name="NORM / PRO 导航与草稿"]')
  await switchMode('NORM')
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-work-mode-preview] .session-mode-badge').length), 0)
  await page.fill('[data-work-mode-chat] [contenteditable="true"]', 'NORM 铭牌验证草稿')
  await switchMode('PRO')
  await checkBadge()
  await page.fill('[data-work-mode-chat] [contenteditable="true"]', 'PRO 铭牌验证草稿')
  await switchMode('NORM')
  assert.equal(await page.evaluate(() => document.querySelector('[data-work-mode-chat] [contenteditable=true]').textContent), 'NORM 铭牌验证草稿')
  await switchMode('PRO')
  assert.equal(await page.evaluate(() => document.querySelector('[data-work-mode-chat] [contenteditable=true]').textContent), 'PRO 铭牌验证草稿')
  await page.click('[data-session-id=pro-root] .entity-row-btn')
  await page.waitForFunction(() => document.querySelector('[data-work-mode-chat] h1')?.textContent === '成本核对')
  await checkBadge()
  await page.click('loc=role:button[name="打开 PRO 子会话深链接"]')
  await page.waitForSelector('[data-work-mode-chat] a[href="https://example.com/costs"]')
  const colors = []
  for (const name of ['Dark', 'Light']) {
    await theme(name)
    colors.push(await checkBadge())
    await capture(`pro-composer-${name.toLowerCase()}`, '[data-work-mode-chat]')
    await page.hover(badgeSelector)
    await page.waitForSelector('[role=tooltip]')
    assert.equal(await page.evaluate(() => document.querySelector('[role=tooltip]').textContent), '当前处于 PRO 模式')
    await capture(`pro-composer-tooltip-${name.toLowerCase()}`, '[data-work-mode-chat]')
    await page.hover('[data-work-mode-chat] h1')
    await page.waitForFunction(() => !document.querySelector('[role=tooltip]'))
    await page.focus(badgeSelector)
    await page.waitForSelector('[role=tooltip]')
    assert.ok(await page.evaluate(selector => document.activeElement.matches(selector) && document.querySelector('[role=tooltip]').textContent === '当前处于 PRO 模式', badgeSelector))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role=tooltip]'))
    await page.click('[data-work-mode-chat] button[aria-label="在文件夹中工作"]')
    await page.waitForSelector('[role=dialog]')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  }
  assert.notEqual(colors[0], colors[1], 'each theme uses its own gold')
  await page.click('xpath=//label[text()="compactInput"]/../following-sibling::button')
  for (const name of ['Light', 'Dark']) {
    await page.evaluate(() => document.getElementById('badge-qa-viewport')?.remove())
    await page.cdp('Emulation.clearDeviceMetricsOverride')
    await theme(name)
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.id = 'badge-qa-viewport'
      style.textContent = '[data-work-mode-preview] { position: fixed; inset: 16px; height: calc(100dvh - 32px); width: auto; z-index: 40; } [data-work-mode-list], [data-work-mode-topbar] { display: none; }'
      document.head.append(style)
    })
    await checkBadge()
    await page.hover(badgeSelector)
    await page.waitForSelector('[role=tooltip]')
    await capture(`pro-composer-compact-${name.toLowerCase()}`, '[data-work-mode-chat]')
    await page.hover('[data-work-mode-chat] h1')
    await page.waitForFunction(() => !document.querySelector('[role=tooltip]'))
  }
  console.log({ passed: true, placement: 'after working directory', permanent: true, hoverAndFocus: true, themes: 2, draftsPreserved: true, rootAndWorker: true, compactWidth: 390, normUnchanged: true, outputDir: directory })
} finally {
  await page.evaluate(() => document.getElementById('badge-qa-viewport')?.remove())
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await page.evaluate(async previous => {
    for (const [key, value] of [['playground-selected-component', previous.component], ['craft-theme', previous.theme]]) {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value)
    }
    await (await import(previous.i18nUrl)).i18n.changeLanguage(previous.language)
  }, previous)
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
