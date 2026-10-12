// ego-browser nodejs < scripts/qa-office-collaboration-entry.js
// Resume with globalThis.officeEntryQA = { spaceId, finish, previous }.
const { strict: assert } = await import('node:assert')
const { mkdir, writeFile } = await import('node:fs/promises')
const config = globalThis.officeEntryQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Office 文件卡片验收')
console.log({ spaceId: task.spaceId })
const page = task.page('p1')
const directory = '/tmp/selection-office-cards-qa'
await mkdir(directory, { recursive: true })
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
const previous = config.previous ?? await page.evaluate(() => ({ component: localStorage.getItem('playground-selected-component') }))
await writeFile(`${directory}/preferences.json`, JSON.stringify(previous))
await page.evaluate(() => localStorage.setItem('playground-selected-component', 'office-collaboration-chooser'))
await page.reload()
await page.waitForSelector('[data-office-chooser-qa]')
// Inspect copy requests without changing the user's clipboard.
await page.evaluate(() => {
  window.officeCardClipboard = []
  Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.officeCardClipboard.push(text) } })
})
console.log(await page.snapshot())
const office = '[data-office-collaboration]'
const chooser = '[data-office-panel="open"] [data-office-file-chooser]'
const card = path => `[data-office-panel="open"] [data-office-file-card="${path}"]`
const popup = '[data-slot="popover-content"]'
const panelClosed = () => page.waitForFunction(() => document.querySelector('[data-office-panel]').dataset.officePanel === 'closed')
const noTooltip = () => page.waitForFunction(() => !document.querySelector('[data-slot="tooltip-content"]'))
const read = () => page.evaluate(() => ({
  opens: Number(document.querySelector('[data-office-qa-open-calls]').dataset.officeQaOpenCalls),
  choosing: !!document.querySelector('[data-office-panel="open"] [data-office-file-chooser]'),
  cards: [...document.querySelectorAll('[data-office-panel="open"] [data-office-file-card]')].map(el => ({
    path: el.dataset.officeFileCard, name: el.getAttribute('aria-label'), type: el.querySelector('[data-file-kind]').dataset.fileKind,
  })),
  preview: !!document.querySelector('[data-office-panel="open"] aside:not([hidden]) iframe'),
  previewPath: document.querySelector('[data-office-panel="open"] aside:not([hidden]) strong[title]')?.title,
  popup: !!document.querySelector('[data-slot="popover-content"]'),
  hint: !!document.querySelector('[data-slot="tooltip-content"]'),
  officeFocused: document.activeElement?.matches('[data-office-collaboration]'),
}))
async function screenshot(name) {
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-office-panel="open"]')
    return panel && Math.abs(panel.getBoundingClientRect().width - panel.firstElementChild.getBoundingClientRect().width) < 0.5
  })
  const iconOffsets = await page.evaluate(() => [...document.querySelectorAll('[data-office-file-card]')].map(button => {
    const card = button.closest('li').getBoundingClientRect(), icon = button.querySelector('[data-file-kind]').getBoundingClientRect()
    return Math.abs(card.y+card.height/2-icon.y-icon.height/2)
  }))
  assert.ok(iconOffsets.every(offset => offset < 0.5), 'file icons are vertically centered in their cards')
  const clip = await page.evaluate(() => { const r = document.querySelector('[data-office-chooser-layout]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
  await page.screenshot({ path: `${directory}/${name}.png`, clip })
}
const results = {}
await page.fill('textarea[aria-label="聊天草稿"]', '未发送的草稿')
await page.hover(office)
await page.waitForSelector('[data-slot="tooltip-content"]')
await page.click(office)
await page.waitForSelector(chooser)
await noTooltip()
results.singleEntry = await read()
assert.deepEqual([results.singleEntry.opens, results.singleEntry.preview, results.singleEntry.popup, results.singleEntry.cards.length], [0, false, false, 1])
assert.equal(results.singleEntry.cards[0].type, 'word')
assert.equal(await page.evaluate(() => document.querySelector('[data-office-file-name]').textContent), 'report')
assert.equal(await page.evaluate(() => !!document.querySelector('[data-office-file-picker-trigger]')), false)
assert.equal(await page.evaluate(() => document.querySelector('[data-office-file-path]').textContent), '/demo/report.docx')
await page.click('[data-office-copy-path="/demo/report.docx"]')
assert.equal(await page.evaluate(() => window.officeCardClipboard.at(-1)), '/demo/report.docx')
assert.equal((await read()).opens, 0)
await screenshot('single-file')
await page.click(office)
await panelClosed()
await noTooltip()
assert.equal((await read()).officeFocused, true)

await page.click(office)
await page.click(card('/demo/report.docx'))
await page.waitForSelector('[data-office-panel="open"] aside:not([hidden]) iframe')
results.selectedSingle = await read()
assert.equal(results.selectedSingle.opens, 1)
assert.equal(results.selectedSingle.previewPath, '/demo/report.docx')
await page.click('loc=role:button[name="Switch file"]')
await page.waitForSelector(chooser)
results.switchFile = await read()
assert.deepEqual([results.switchFile.opens, results.switchFile.preview, results.switchFile.popup, results.switchFile.cards.length], [1, false, false, 1])
await page.click('[data-office-panel="open"] button[aria-label="Close Office preview"]')
await panelClosed()
await noTooltip()
assert.equal((await read()).officeFocused, true)

await page.click('loc=role:button[name="多文件"]')
await page.click(office)
await page.waitForSelector(chooser)
results.multiple = await read()
assert.equal(results.multiple.cards.length, 5)
assert.deepEqual(results.multiple.cards.map(item => item.type), ['word', 'excel', 'powerpoint', 'word', 'excel'])
assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-office-file-name]')].slice(0, 4).map(el => el.textContent)), ['report', 'budget', 'slides', 'report'])
assert.equal(results.multiple.opens, 1)
assert.equal(await page.evaluate(() => document.querySelectorAll('[data-office-file-chooser] [data-office-copy-path]').length), 5)
const longPath = '/demo/长路径资料目录/用于验证卡片布局和完整路径的很长文件名称与数据汇总报表.xlsx'
const filenameLayout = await page.evaluate(longPath => {
  const name = document.querySelector(`[data-office-file-card="${longPath}"] [data-office-file-name]`)
  const style = getComputedStyle(name)
  return { length: Array.from(name.textContent).length, extension: name.textContent.endsWith('.xlsx'),
    clamp: style.webkitLineClamp, height: name.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) }
}, longPath)
assert.ok(filenameLayout.length <= 24)
assert.equal(filenameLayout.extension, false)
assert.equal(filenameLayout.clamp, '2')
assert.ok(filenameLayout.height <= filenameLayout.lineHeight * 2 + 1)
results.filenameLayout = filenameLayout
const pathLayout = await page.evaluate(longPath => {
  const path = document.querySelector(`[data-office-file-path="${longPath}"]`)
  const copy = document.querySelector(`[data-office-copy-path="${longPath}"]`)
  const style = getComputedStyle(path), r = path.getBoundingClientRect(), c = copy.getBoundingClientRect()
  return { text: path.textContent, clipped: path.scrollWidth > path.clientWidth, ellipsis: style.textOverflow,
    wrapping: style.whiteSpace, sameLine: Math.abs(r.y+r.height/2-c.y-c.height/2)<1, copyAfter: c.x>=r.right }
}, longPath)
assert.equal(pathLayout.text, longPath)
assert.equal(pathLayout.clipped, true)
assert.equal(pathLayout.ellipsis, 'ellipsis')
assert.equal(pathLayout.wrapping, 'nowrap')
assert.equal(pathLayout.sameLine, true)
assert.equal(pathLayout.copyAfter, true)
results.pathLayout = pathLayout
await page.focus(`[data-office-copy-path="${longPath}"]`)
await page.keyboard.press('Enter')
assert.equal(await page.evaluate(() => window.officeCardClipboard.at(-1)), longPath)
assert.equal((await read()).opens, 1)
results.copyPaths = await page.evaluate(() => window.officeCardClipboard)
await screenshot('multiple-files')
for (const path of ['/demo/budget.xlsx', '/demo/slides.pptx', '/demo/archive/report.docx']) {
  await page.click(card(path))
  await page.waitForFunction(path => document.querySelector('[data-office-panel="open"] aside:not([hidden]) strong[title]')?.title === path, path)
  assert.equal((await read()).previewPath, path)
  await page.click('loc=role:button[name="Switch file"]')
  await page.waitForSelector(chooser)
  assert.equal((await read()).cards.length, 5)
}
results.selectedTypesAndDuplicate = await read()
assert.equal(results.selectedTypesAndDuplicate.opens, 4)
await page.focus(card('/demo/report.docx'))
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.querySelector('[data-office-panel="open"] aside:not([hidden]) strong[title]')?.title === '/demo/report.docx')
await page.click('[data-office-panel="open"] button[aria-label="Close Office preview"]')
await panelClosed()
await noTooltip()

// Keyboard entry and Escape retain the original draft and suppress restored-focus hints.
await page.click('textarea[aria-label="聊天草稿"]')
await page.keyboard.press('Shift+Tab')
await page.waitForSelector('[data-slot="tooltip-content"]')
await page.keyboard.press('Enter')
await page.waitForSelector(chooser)
await noTooltip()
await page.focus(card('/demo/report.docx'))
await page.keyboard.press('Escape')
await panelClosed()
await noTooltip()
results.keyboardClose = await read()
assert.equal(results.keyboardClose.officeFocused, true)
assert.equal(results.keyboardClose.hint, false)
assert.equal(await page.evaluate(() => document.querySelector('textarea[aria-label="聊天草稿"]').value), '未发送的草稿')
const before = results.keyboardClose.opens

await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await page.click(office)
await page.waitForSelector(chooser)
assert.equal((await read()).opens, before)
await page.click(office)
await panelClosed()
await noTooltip()
await page.cdp('Emulation.setEmulatedMedia', { features: [] })

await page.click('loc=role:button[name="空列表"]')
await page.click(office)
await page.waitForSelector(chooser)
results.empty = await read()
assert.equal(results.empty.cards.length, 0)
assert.equal(results.empty.opens, before)
await page.click(office)
await panelClosed()

await page.click('loc=role:button[name="大量文件"]')
await page.click(office)
await page.waitForSelector(chooser)
results.manyFiles = await read()
assert.equal(results.manyFiles.cards.length, 40)
assert.equal(results.manyFiles.opens, before)
assert.equal(await page.evaluate(() => { const list = document.querySelector('[data-office-file-chooser] ul').parentElement; return list.scrollHeight > list.clientHeight }), true)
await page.click(card('/demo/reports/report-40.docx'))
await page.waitForFunction(() => document.querySelector('[data-office-panel="open"] aside:not([hidden]) strong[title]')?.title === '/demo/reports/report-40.docx')
results.lastCard = await read()
assert.equal(results.lastCard.previewPath, '/demo/reports/report-40.docx')
await page.click('[data-office-panel="open"] button[aria-label="Close Office preview"]')
await panelClosed()

// The existing /office-edit entry keeps its candidate popover.
await page.click('loc=role:button[name="旧命令选择框"]')
await page.waitForSelector(popup)
assert.equal(await page.evaluate(() => document.querySelector('[data-office-panel]').dataset.officePanel), 'closed')
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('[data-slot="popover-content"]'))
results.legacyCommand = await read()

await writeFile(`${directory}/result.json`, JSON.stringify(results, null, 2))
await page.evaluate(previous => {
  if (previous.component === null) localStorage.removeItem('playground-selected-component')
  else localStorage.setItem('playground-selected-component', previous.component)
}, previous)
console.log(results)
if (config.finish !== false) await task.finish({ keep: [] })
