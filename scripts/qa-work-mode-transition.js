// ego-browser nodejs < scripts/qa-work-mode-transition.js
// Resume with globalThis.motionQA = { spaceId, outputDir }.
const { strict: assert } = await import('node:assert')
const { mkdir } = await import('node:fs/promises')
const config = globalThis.motionQA ?? {}
const task = await taskSpace(config.spaceId ?? 'NORM PRO motion QA')
const page = task.page('p1')
const directory = config.outputDir ?? '/tmp/selection-work-mode-motion'
await mkdir(directory, { recursive: true })
await page.goto('http://127.0.0.1:5187/playground.html')
const previous = await page.evaluate(() => ({ component: localStorage.getItem('playground-selected-component'), theme: localStorage.getItem('craft-theme') }))
const settled = mode => page.waitForFunction(mode => document.documentElement.dataset.workMode === mode && !document.documentElement.dataset.workModeTransitionPhase, mode)
const switchMode = async mode => { await page.click(`loc=role:button[name="${mode}"]`); await settled(mode) }
const editor = '[data-work-mode-chat] [contenteditable="true"]'
const readDraft = () => page.evaluate(() => document.querySelector('[data-work-mode-chat] [contenteditable="true"]').textContent.replaceAll('\u200b', ''))
async function capture(name) {
  const clip = await page.evaluate(() => { const r = document.querySelector('[data-work-mode-preview]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
  await page.screenshot({ path: `${directory}/${name}.png`, clip })
}
// Pause the real compositor animations at a reproducible intermediate frame.
async function probe(mode, reduced = false) {
  await page.evaluate(() => {
    window.motionQAProbe = null
    window.motionQAOriginal = document.startViewTransition.bind(document)
    document.startViewTransition = callback => {
      const transition = window.motionQAOriginal(callback)
      transition.ready.then(() => {
        const animations = document.getAnimations().filter(a => a.animationName?.startsWith('work-mode-'))
        animations.forEach(a => { a.pause(); a.currentTime = 60 })
        window.motionQAAnimations = animations
        const root = document.documentElement
        window.motionQAProbe = { mode: root.dataset.workMode, rootName: getComputedStyle(root).viewTransitionName,
          chromeName: getComputedStyle(document.querySelector('[data-work-mode-topbar]')).viewTransitionName,
          animations: animations.map(a => ({ name: a.animationName, pseudo: a.effect.pseudoElement, duration: a.effect.getTiming().duration, frames: a.effect.getKeyframes() })),
          opacities: ['list', 'chat'].map(role => ['old', 'new'].map(state => Number(getComputedStyle(root, `::view-transition-${state}(work-mode-${role})`).opacity))),
          surfaces: document.querySelectorAll('[data-work-mode-transition]').length, editors: document.querySelectorAll('[data-work-mode-chat] [contenteditable=true]').length }
      }).catch(error => { window.motionQAProbe = { error: error.message } })
      return transition
    }
  })
  await page.click(`loc=role:button[name="${mode}"]`)
  await page.waitForFunction(() => window.motionQAProbe)
  const result = await page.evaluate(() => window.motionQAProbe)
  assert.equal(result.error, undefined, 'native snapshots must animate instead of skipping')
  assert.equal(result.mode, mode)
  assert.equal(result.rootName, 'none')
  assert.equal(result.chromeName, 'none')
  assert.equal(result.animations.length, 4, 'both old and new list/chat views overlap')
  assert.equal(result.surfaces, 2)
  assert.equal(result.editors, 1, 'the transition does not mount an extra composer')
  for (const pair of result.opacities) {
    assert.ok(pair.every(value => value > 0 && value < 1), 'both pictures are visible at the midpoint')
    assert.ok(Math.abs(pair[0] + pair[1] - 1) < .01, 'matching fades preserve brightness without a blank gap')
  }
  for (const animation of result.animations) {
    assert.equal(animation.duration, reduced ? 150 : 240)
    assert.ok(animation.frames.every(frame => !frame.transform || frame.transform === 'none'), 'content dissolves without moving or scaling the frame')
  }
  await capture(`${reduced ? 'reduced' : 'midpoint'}-${mode.toLowerCase()}`)
  await page.evaluate(() => { window.motionQAAnimations.forEach(a => a.play()); document.startViewTransition = window.motionQAOriginal })
  await settled(mode)
  return result
}
try {
  await page.click('loc=role:button[name="NORM / PRO 导航与草稿"]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(match => match[1]).find(url => url.includes('/i18n/'))
    await (await import(url)).i18n.changeLanguage('zh-Hans')
  })
  await switchMode('NORM')
  await page.fill(editor, 'NORM 独立草稿')
  const forward = await probe('PRO')
  assert.equal(await readDraft(), '')
  await page.fill(editor, 'PRO 独立草稿')
  const back = await probe('NORM')
  assert.equal(await readDraft(), 'NORM 独立草稿')
  await switchMode('PRO')
  assert.equal(await readDraft(), 'PRO 独立草稿')
  assert.equal(await page.evaluate(() => document.querySelector('[data-work-mode-chat]').textContent.includes('original-model')), true)
  // A click back to the current mode cancels a still-pending snapshot callback.
  await switchMode('NORM')
  await page.evaluate(() => { const buttons = [...document.querySelectorAll('[data-work-mode-topbar] button')]; buttons.find(b => b.textContent === 'PRO').click(); buttons.find(b => b.textContent === 'NORM').click() })
  await settled('NORM')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await readDraft(), 'NORM 独立草稿')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.workMode), 'NORM')
  // A navigation wins over the queued mode update.
  await page.evaluate(() => { [...document.querySelectorAll('[data-work-mode-topbar] button')].find(b => b.textContent === 'PRO').click(); window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route: 'settings' } })) })
  await settled('NORM')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => document.documentElement.dataset.workMode), 'NORM')
  await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const reduced = await probe('PRO', true)
  assert.equal(await readDraft(), 'PRO 独立草稿')
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
  await switchMode('NORM')
  // An older web runtime still navigates and restores its styles.
  await page.evaluate(() => { window.motionQAFallback = document.startViewTransition; document.startViewTransition = undefined })
  await switchMode('PRO')
  assert.equal(await readDraft(), 'PRO 独立草稿')
  await page.evaluate(() => { document.startViewTransition = window.motionQAFallback })
  await page.click('xpath=//label[text()="compactTopBar"]/../following-sibling::button')
  await page.click('xpath=//label[text()="compactInput"]/../following-sibling::button')
  await page.focus('loc=role:button[name="NORM"]')
  await page.keyboard.press('Space')
  await settled('NORM')
  assert.equal(await readDraft(), 'NORM 独立草稿')
  await page.focus('loc=role:button[name="PRO"]')
  await page.keyboard.press('Enter')
  await settled('PRO')
  assert.equal(await readDraft(), 'PRO 独立草稿')
  assert.equal(await page.evaluate(() => { const top = document.querySelector('[data-work-mode-topbar]').getBoundingClientRect(); return [...document.querySelectorAll('[data-work-mode-topbar] button[aria-pressed]')].every(b => b.getBoundingClientRect().right <= top.right) }), true)
  await capture('compact-pro')
  await page.click('xpath=//label[text()="compactTopBar"]/../following-sibling::button')
  await page.click('xpath=//label[text()="compactInput"]/../following-sibling::button')
  for (const theme of ['Dark', 'Light']) { await page.click(`loc=role:button[name="${theme}"]`); await capture(`pro-${theme.toLowerCase()}`) }
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-work-mode-transition]')].every(e => getComputedStyle(e).opacity === '1' && getComputedStyle(e).pointerEvents !== 'none' && getComputedStyle(e).viewTransitionName === 'none')), true)
  console.log({ passed: true, overlappingSnapshots: [forward.opacities, back.opacities], draftPreserved: true, cancelledNavigation: true, reducedMotion: reduced.animations.map(a => a.duration), fallback: true, compactKeyboard: true, outputDir: directory })
} finally {
  await page.evaluate(previous => {
    window.motionQAAnimations?.forEach(a => a.play())
    if (window.motionQAOriginal) document.startViewTransition = window.motionQAOriginal
    for (const [key, value] of [['playground-selected-component', previous.component], ['craft-theme', previous.theme]]) {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value)
    }
  }, previous)
  await page.cdp('Emulation.setEmulatedMedia', { features: [] })
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
