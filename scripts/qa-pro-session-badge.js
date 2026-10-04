// ego-browser nodejs < scripts/qa-pro-session-badge.js
// Resume the same space with globalThis.badgeQA = { spaceId, outputDir }.
const { strict: assert } = await import('node:assert')
const { mkdir } = await import('node:fs/promises')
const config = globalThis.badgeQA ?? {}
const task = await taskSpace(config.spaceId ?? 'PRO session badge QA')
const page = task.page('p1')
const directory = config.outputDir ?? '/tmp/selection-pro-session-badge'
await mkdir(directory, { recursive: true })
await page.goto('http://127.0.0.1:5187/playground.html')
const previous = await page.evaluate(() => ({
  component: localStorage.getItem('playground-selected-component'),
  confirmation: localStorage.getItem('craft-skip-handover-confirmation'),
}))
async function capture(name, selector) {
  const clip = await page.evaluate(selector => {
    const r = document.querySelector(selector).getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }, selector)
  await page.screenshot({ path: `${directory}/${name}.png`, clip })
}
try {
  await page.click('loc=role:button[name="NORM / PRO 导航与草稿"]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(match => match[1]).find(url => url.includes('/i18n/'))
    await (await import(url)).i18n.changeLanguage('zh-Hans')
  })
  await page.click('[data-work-mode-preview] button:text-is("PRO")')
  await page.click('[data-session-id=pro-root] .entity-row-btn')
  await page.waitForFunction(() => document.querySelector('[data-work-mode-chat] h1')?.textContent === '成本核对')
  for (const theme of ['Dark', 'Light']) {
    await page.click(`loc=role:button[name="${theme}"]`)
    const result = await page.evaluate(() => {
      const list = document.querySelector('[data-work-mode-list]'), row = document.querySelector('[data-session-id=pro-root]')
      const listTitle = list.querySelector('h1'), badge = list.querySelector('.session-mode-badge'), header = document.querySelector('[data-work-mode-chat] h1')
      const badgeBounds = badge.getBoundingClientRect(), titleBounds = listTitle.getBoundingClientRect()
      return { title: row.querySelector('.font-sans.truncate').textContent, heading: header.textContent,
        listTitle: listTitle.textContent, badge: badge.textContent, listBadgeCount: list.querySelectorAll('.session-mode-badge').length,
        rowBadgeCount: row.querySelectorAll('.session-mode-badge').length, headerBadgeCount: document.querySelectorAll('[data-work-mode-chat] .session-mode-badge').length,
        afterTitle: badgeBounds.left >= titleBounds.right, height: badgeBounds.height, fits: badgeBounds.right < list.getBoundingClientRect().right,
        background: getComputedStyle(badge).backgroundColor, radius: getComputedStyle(badge).borderRadius }
    })
    assert.equal(result.title, '成本核对')
    assert.equal(result.heading, '成本核对')
    assert.equal(result.badge, 'PRO')
    assert.equal(result.listTitle, '普通会话')
    assert.equal(result.listBadgeCount, 1)
    assert.equal(result.rowBadgeCount, 0)
    assert.equal(result.headerBadgeCount, 1)
    assert.ok(result.afterTitle && result.fits)
    assert.equal(result.height, 18)
    assert.notEqual(result.radius, '0px')
    assert.equal(result.background, 'rgba(0, 0, 0, 0)')
    await capture(`pro-badge-${theme.toLowerCase()}`, '[data-work-mode-preview]')
  }
  await page.evaluate(() => {
    const row = document.querySelector('[data-session-id=pro-root]')
    row.style.width = '210px'
    row.querySelector('.font-sans.truncate').textContent = '这是一个需要截断的很长会话名称'.repeat(3)
  })
  assert.ok(await page.evaluate(() => {
    const row = document.querySelector('[data-session-id=pro-root]'), title = row.querySelector('.font-sans.truncate')
    return title.scrollWidth > title.clientWidth && getComputedStyle(title).textOverflow === 'ellipsis'
      && title.getBoundingClientRect().right < row.getBoundingClientRect().right
  }), 'a long conversation title truncates without row badges')
  await page.click('[data-work-mode-preview] button:text-is("NORM")')
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-work-mode-preview] .session-mode-badge').length), 0)
  await page.click('loc=role:button[name="会话交接与来源"]')
  await page.selectOption('select', 'compact')
  await page.click('[data-handover-trigger]')
  await page.waitForFunction(() => !!document.querySelector('[role=dialog]') || document.querySelector('[data-handover-session]').dataset.handoverMode === 'PRO')
  if (await page.evaluate(() => !!document.querySelector('[role=dialog]'))) await page.click('[role=dialog] button:text-is("交接到 PRO")')
  await page.waitForFunction(() => document.querySelector('[data-handover-session]').dataset.handoverMode === 'PRO')
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'badge-qa-viewport'
    style.textContent = '[data-handover-session] { position: fixed; inset: 16px; height: calc(100dvh - 32px); z-index: 40; }'
    document.head.append(style)
  })
  await page.click('[data-handover-title-menu]')
  await page.waitForSelector('[role=dialog] .session-mode-badge')
  assert.ok(await page.evaluate(() => {
    const dialog = document.querySelector('[role=dialog]'), title = dialog.querySelector('h2'), badge = dialog.querySelector('.session-mode-badge')
    return title.textContent === '成本核对' && badge.textContent === 'PRO' && dialog.scrollWidth <= dialog.clientWidth
  }), 'compact menu keeps the name and mode separate')
  await capture('pro-badge-compact-menu', '[role=dialog]')
  await page.keyboard.press('Escape')
  console.log({ passed: true, legacyTitles: true, listHeadingBadgeOnly: true, chatHeading: true, themes: 2, longTitle: true, normUnchanged: true, compactMenu: true, outputDir: directory })
} finally {
  await page.evaluate(() => document.getElementById('badge-qa-viewport')?.remove())
  await page.cdp('Emulation.clearDeviceMetricsOverride')
  await page.evaluate(previous => {
    for (const [key, value] of [['playground-selected-component', previous.component], ['craft-skip-handover-confirmation', previous.confirmation]]) {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value)
    }
  }, previous)
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
