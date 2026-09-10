// Run in the existing Selection Vite playground via playwright-cli run-code.
// Example: playwright-cli -s=qa open http://localhost:5173/playground.html
//          playwright-cli -s=qa run-code "$(< scripts/qa-279-282-browser.js)"
async (page) => {
  await page.evaluate(async () => {
    // Resolve Vite's optimized React URLs from its transformed entry, avoiding
    // hard-coded dependency hashes or a second React instance.
    const entry = await (await fetch('/playground.tsx')).text()
    const urls = [...entry.matchAll(/from "([^"]+)"/g)].map(match => match[1])
    const reactUrl = urls.find(url => /\/react\.js\?/.test(url))
    const domUrl = urls.find(url => /\/react-dom_client\.js\?/.test(url))
    if (!reactUrl || !domUrl) throw new Error('Vite React imports not found')
    const R = (await import(reactUrl)).default
    const D = (await import(domUrl)).default
    const workspace = reactUrl.split('/apps/electron/')[0]
    const { Markdown, MemoizedMarkdown } = await import(workspace + '/packages/ui/src/components/markdown/Markdown.tsx')
    const { ResponseCard } = await import(workspace + '/packages/ui/src/components/chat/TurnCard.tsx')
    const { TooltipProvider } = await import(workspace + '/packages/ui/src/components/tooltip.tsx')
    const { TaskOrchestrationEditButton } = await import('/components/ui/TaskOrchestrationEditButton.tsx')
    window.__issueQA?.restore()
    window.__issueQA?.root.unmount()
    document.querySelector('#qa-fixture')?.remove()
    const host = document.createElement('div')
    host.id = 'qa-fixture'
    host.style.cssText = 'position:fixed;inset:32px;z-index:100;padding:24px;overflow:auto;background:var(--background);max-width:760px'
    document.body.append(host)
    const root = D.createRoot(host)
    const animations = []
    const original = Element.prototype.animate
    Element.prototype.animate = function(frames, options) {
      const animation = original.call(this, frames, options)
      animations.push({ element: this, animation, options, frames })
      return animation
    }
    const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    window.__issueQA = {
      host, root, animations, wait, edits: 0,
      async markdown(props) {
        root.render(R.createElement(R.StrictMode, null, R.createElement(Markdown, props)))
        await wait()
      },
      async response(props) {
        root.render(R.createElement(ResponseCard, props))
        await wait()
      },
      async memoized(props) {
        root.render(R.createElement(MemoizedMarkdown, props))
        await wait()
      },
      async button(compact = false, disabled = false) {
        root.render(R.createElement(TooltipProvider, null,
          R.createElement(TaskOrchestrationEditButton, { compact, disabled, onEdit: () => { window.__issueQA.edits++ } }),
          R.createElement('input', { 'aria-label': 'Outside input', style: { marginTop: 400, display: 'block' } })))
        await wait()
      },
      restore() { Element.prototype.animate = original },
    }
  })
  const markdown = await page.evaluate(async () => {
    const q = window.__issueQA
    const assert = (ok, message) => { if (!ok) throw new Error(message) }
    const id = `browser-${Date.now()}`
    await q.markdown({ id, isStreaming: true, children: 'First paragraph.\n\nSecond paragraph.' })
    assert(q.host.textContent.includes('Second paragraph.'), 'complete source missing')
    assert(q.animations.some(item => item.animation.playState === 'running'), 'StrictMode reveal inactive')
    const first = q.host.querySelector('p')
    const count = q.animations.length
    await q.markdown({ id, isStreaming: true, children: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.' })
    assert(q.host.querySelector('p') === first, 'append remounted completed paragraph')
    assert(q.animations.slice(count).every(item => item.element !== first), 'append replayed first paragraph')
    const beforeComplete = q.animations.length
    await q.markdown({ id, isStreaming: false, children: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.' })
    assert(q.host.querySelector('p') === first, 'completion remounted paragraph')
    assert(q.animations.length === beforeComplete, 'completion replayed content')
    await q.markdown({ id: 'history-' + id, revealStartTime: Date.now() - 60_000, children: 'Historical content.' })
    assert(q.animations.length === beforeComplete, 'history animated')
    await q.markdown({ id: 'long-' + id, isStreaming: true, children: ('中文 English mixed paragraph. '.repeat(180)) })
    assert(q.animations.some(item => item.frames[0].clipPath), 'long paragraph lacks line reveal')
    const range = document.createRange()
    range.selectNodeContents(q.host)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    assert(q.animations.every(item => item.animation.playState !== 'running'), 'selection did not cancel animations')
    assert(window.getSelection().toString().includes('中文 English'), 'full text not selectable')
    window.getSelection().removeAllRanges()
    const beforeRemount = q.animations.length
    await q.markdown({ id, isStreaming: true, children: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.' })
    assert(q.animations.length === beforeRemount, 'revisited streaming identity replayed')
    await q.markdown({ id: 'wheel-' + id, isStreaming: true, children: 'Manual scroll cancellation.\n\nAnother paragraph.' })
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    assert(q.animations.every(item => item.animation.playState !== 'running'), 'wheel did not cancel animations')
    await q.memoized({ children: '[Target](https://example.com)', onUrlClick: () => { q.link = 'old' } })
    await q.memoized({ children: '[Target](https://example.com)', className: 'updated', onUrlClick: () => { q.link = 'new' } })
    q.host.querySelector('a').click()
    assert(q.link === 'new', 'memoized Markdown retained stale URL callback without an id')
    assert(q.host.querySelector('.markdown-content').classList.contains('updated'), 'memoized Markdown ignored presentation prop')
    const response = { text: 'Real response first paragraph.\n\nSecond paragraph.', sessionId: id, messageId: 'response', streamStartTime: Date.now() - 2000 }
    await q.response({ ...response, isStreaming: true, isTurnComplete: false })
    const responseParagraph = q.host.querySelector('[data-search-root="response"] p')
    assert(responseParagraph, 'streaming response body missing')
    await q.response({ ...response, isStreaming: false, isTurnComplete: true, completedRevealStartTime: Date.now() })
    assert(q.host.querySelector('[data-search-root="response"] p') === responseParagraph, 'ResponseCard completion remounted Markdown')
    return { responseCompletion: true, memoizedProps: true, strictMode: true, stableAppend: true, stableCompletion: true, history: true, longParagraph: true, fullSelection: true, replayGuard: true, wheelCancel: true }
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await page.evaluate(async () => {
    const q = window.__issueQA
    const before = q.animations.length
    await q.markdown({ id: 'reduced-' + Date.now(), isStreaming: true, children: 'Reduced motion content.' })
    if (q.animations.length !== before) throw new Error('reduced motion animated')
    return true
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => window.__issueQA.button())
  const trigger = page.locator('#qa-fixture button').first()
  await trigger.focus()
  await page.getByRole('tooltip').waitFor({ state: 'visible' })
  const tooltip = await page.getByRole('tooltip').innerText()
  if (!/orchestration|编排/.test(tooltip)) throw new Error('missing tooltip purpose')
  await trigger.press('Enter')
  if (await page.evaluate(() => window.__issueQA.edits) !== 1) throw new Error('desktop keyboard failed')
  await page.evaluate(() => window.__issueQA.button(true))
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible' })
  if (await page.evaluate(() => window.__issueQA.edits) !== 1) throw new Error('compact navigated before explanation')
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelector('[role=dialog]')?.contains(document.activeElement))
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 3000 })
  await page.waitForFunction(() => document.querySelector('#qa-fixture button') === document.activeElement)
  await trigger.click()
  await dialog.waitFor({ state: 'visible' })
  await page.getByRole('textbox', { name: 'Outside input' }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 3000 })
  if (!await page.getByRole('textbox', { name: 'Outside input' }).evaluate(element => element === document.activeElement)) throw new Error('outside focus stolen')
  await trigger.click()
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button').click()
  if (await page.evaluate(() => window.__issueQA.edits) !== 2) throw new Error('confirmation did not invoke edit once')
  await dialog.waitFor({ state: 'hidden', timeout: 3000 })
  await page.evaluate(() => window.__issueQA.button(false))
  // Real DOM pointer events retain touch/pen provenance; click detail matches
  // the synthesized browser click following a tap rather than keyboard detail=0.
  for (const pointerType of ['touch', 'pen']) {
    await trigger.dispatchEvent('pointerdown', { pointerType })
    await trigger.dispatchEvent('click', { detail: 1 })
    await dialog.waitFor({ state: 'visible' })
    if (await page.evaluate(() => window.__issueQA.edits) !== 2) throw new Error(pointerType + ' navigated prematurely')
    await page.getByRole('tooltip').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.querySelector('[role=dialog]')?.contains(document.activeElement))
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 3000 })
  }
  await trigger.press('Enter')
  if (await page.evaluate(() => window.__issueQA.edits) !== 3) throw new Error('keyboard inherited pointer provenance')
  await page.evaluate(() => window.__issueQA.button(false, true))
  if (!await trigger.isDisabled()) throw new Error('disabled entry active')
  await page.evaluate(() => window.__issueQA.restore())
  return { markdown, reducedMotion: reduced, entry: { keyboard: true, tooltip: true, compact: true, touch: true, pen: true, escapeFocus: true, outsideFocus: true, confirmation: true, disabled: true } }
}
