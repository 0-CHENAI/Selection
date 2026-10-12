// ego-browser nodejs < scripts/qa-long-conversation.js
// Resume with globalThis.lazyChatQA = { spaceId, url, outputDir, finish }.
const { strict: assert } = await import('node:assert')
const { mkdir, writeFile } = await import('node:fs/promises')
const config = globalThis.lazyChatQA ?? {}
const task = await taskSpace(config.spaceId ?? '长对话可见区域渲染验收')
console.log({ spaceId: task.spaceId })
const page = task.page('p1')
const directory = config.outputDir ?? '/tmp/selection-virtual-chat-qa'
await mkdir(directory, { recursive: true })
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
const previous = await page.evaluate(() => localStorage.getItem('playground-selected-component'))
await page.evaluate(() => localStorage.setItem('playground-selected-component', 'long-conversation-pagination'))
await page.reload()
await page.waitForSelector('[data-long-history-controls]')
await page.click('loc=role:button[name="打开长对话"]')
const bottom = () => page.waitForFunction(() => {
  const c = document.querySelector('[data-work-mode-chat] [data-chat-total-turns]'), v = c?.querySelector('[data-radix-scroll-area-viewport]')
  return Number(c?.dataset.chatTotalTurns) >= 240 && c.dataset.chatWindowEnd === c.dataset.chatTotalTurns
    && v && Math.abs(v.scrollHeight - v.scrollTop - v.clientHeight) <= 1
})
await bottom()
const read = () => page.evaluate(() => {
  const c = document.querySelector('[data-work-mode-chat] [data-chat-total-turns]'), v = c.querySelector('[data-radix-scroll-area-viewport]')
  return { start: Number(c.dataset.chatWindowStart), end: Number(c.dataset.chatWindowEnd), total: Number(c.dataset.chatTotalTurns),
    mounted: c.querySelectorAll('[data-chat-turn-key]').length, active: c.querySelectorAll('[data-chat-virtual-visible="true"]').length, top: v.scrollTop, height: v.scrollHeight,
    bottom: v.scrollHeight - v.scrollTop - v.clientHeight, highlights: CSS.highlights?.get('search-active')?.size ?? 0 }
})
const results = { initial: await read(), scrolling: [] }
assert.ok(results.initial.active < 10)
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-chat-turn-key]')]
  window.__cachedTail = rows.at(-1)
  window.__cachedTailKey = window.__cachedTail.dataset.chatTurnKey
  window.__cachedBody = window.__cachedTail.querySelector('[data-search-root="response"]')
})
const point = await page.evaluate(() => {const r=document.querySelector('[data-work-mode-chat] [data-radix-scroll-area-viewport]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
await page.mouse.move(point.x, point.y)
for (let n = 0; n < 24; n++) {
  await page.mouse.wheel(0, -240, { label: '阅读较早的消息' })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  const state = await read(); assert.ok(state.active < 10); results.scrolling.push(state)
}
assert.ok(results.scrolling.at(-1).start < results.initial.start)
assert.equal(await page.evaluate(() => window.__cachedTail.isConnected && window.__cachedBody.isConnected), true,
  'loaded content remains mounted while reading earlier replies')
// Once a row is measured, a later size change above the fold must retain the reading anchor.
results.anchor = await page.evaluate(async () => {
  const v = document.querySelector('[data-work-mode-chat] [data-radix-scroll-area-viewport]')
  const rows = [...v.querySelectorAll('[data-index]')], top = v.getBoundingClientRect().top
  const visible = rows.find(row => row.getBoundingClientRect().bottom > top)
  const earlier = rows.find(row => row.getBoundingClientRect().bottom < top)
  if (!earlier || !visible) return null
  const before = visible.getBoundingClientRect().top
  earlier.style.paddingBottom = '80px'
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const shift = visible.getBoundingClientRect().top - before
  earlier.style.paddingBottom = ''
  return { shift }
})
if (results.anchor) assert.ok(Math.abs(results.anchor.shift) <= 1)
await page.evaluate(() => { document.querySelector('nav[aria-label="Conversation records"]').scrollTop = 0 })
await page.click('loc=role:button[name="Go to record 1: 第 1 轮：请核对成本与依据。"]')
await page.waitForFunction(() => document.querySelector('[data-work-mode-chat] [data-chat-window-start="0"]'))
results.outline = await read()
assert.ok(results.outline.active < 10)
assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-chat-virtual-visible="true"]')].some(row=>row.textContent.includes('Regenerate'))), false)
await page.fill('input[aria-label="搜索长对话"]', 'needle-early-007')
await page.waitForFunction(() => Number(document.querySelector('[data-history-match-count]').dataset.historyMatchCount) === 1 && (CSS.highlights?.get('search-active')?.size ?? 0) === 1)
results.uniqueSearch = await read()
assert.ok(results.uniqueSearch.start <= 15 && results.uniqueSearch.end > 15)
await page.fill('input[aria-label="搜索长对话"]', '滚动验收')
await page.waitForFunction(() => Number(document.querySelector('[data-history-match-count]').dataset.historyMatchCount) === 120)
await page.click('loc=role:button[name="下一处"]')
await page.waitForFunction(() => Number(document.querySelector('[data-history-match-index]').dataset.historyMatchIndex) === 1 && (CSS.highlights?.get('search-active')?.size ?? 0) === 1)
results.multipleSearch = await read()
assert.ok(results.multipleSearch.start <= 3 && results.multipleSearch.end > 3)
await page.fill('input[aria-label="搜索长对话"]', '')
await page.click('[data-testid="chat-scroll-to-bottom"]'); await bottom()
results.cacheReuse = await page.evaluate(() => {
  const row = [...document.querySelectorAll('[data-chat-turn-key]')].find(el => el.dataset.chatTurnKey === window.__cachedTailKey)
  return row === window.__cachedTail && row.querySelector('[data-search-root="response"]') === window.__cachedBody
})
assert.equal(results.cacheReuse, true, 'returning to loaded content reuses the same row and Markdown DOM')
await page.click('loc=role:button[name="追加一轮消息"]'); await bottom()
await page.waitForFunction(() => document.querySelector('[data-work-mode-chat] [data-chat-total-turns="242"] [data-chat-turn-key="user-append-user-240"]'))
results.append = await read()
await page.click('loc=role:button[name="延长当前回复"]'); await bottom()
results.streamingBottom = await read()
await page.mouse.move(point.x, point.y)
await page.mouse.wheel(0, -700, { label: '暂停跟随并阅读历史' })
await page.waitForSelector('[data-testid="chat-scroll-to-bottom"]')
await page.waitForSelector('[data-chat-virtual-scrolling="false"]')
const readingAnchor = () => page.evaluate(() => {
  const v = document.querySelector('[data-work-mode-chat] [data-radix-scroll-area-viewport]'), bounds = v.getBoundingClientRect()
  const row = [...v.querySelectorAll('[data-chat-turn-key]')].find(el => {const r=el.getBoundingClientRect();return r.bottom>bounds.top && r.top<bounds.bottom})
  return { key: row.dataset.chatTurnKey, offset: row.getBoundingClientRect().top-bounds.top }
})
const paused = await read(), anchor = await readingAnchor()
await page.click('loc=role:button[name="延长当前回复"]')
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
results.streamingPaused = await read()
const restoredAnchor = await readingAnchor()
results.streamingPaused.anchorShift = restoredAnchor.offset - anchor.offset
assert.equal(restoredAnchor.key, anchor.key)
assert.ok(Math.abs(results.streamingPaused.anchorShift) <= 1)
await page.click('loc=role:button[name="打开 PRO 子会话深链接"]')
await page.waitForFunction(() => document.querySelector('[data-work-mode-chat] [data-chat-total-turns="1"]') && !window.__cachedTail.isConnected)
results.cacheReleased = await page.evaluate(() => !window.__cachedTail.isConnected && !window.__cachedBody.isConnected)
assert.equal(results.cacheReleased, true, 'switching conversations releases the previous cache')
await page.click('loc=role:button[name="打开长对话"]'); await bottom()
results.reopen = await read(); assert.ok(results.reopen.active < 10)
const clip = await page.evaluate(() => {const r=document.querySelector('[data-work-mode-preview]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})
await page.screenshot({ path: `${directory}/latest-page.png`, clip })
await writeFile(`${directory}/result.json`, JSON.stringify(results, null, 2))
await page.evaluate(value => {if (value === null) localStorage.removeItem('playground-selected-component');else localStorage.setItem('playground-selected-component', value)}, previous)
console.log(results)
if (config.finish !== false) await task.finish({ keep: [] })
