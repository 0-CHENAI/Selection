// ego-browser nodejs < scripts/qa-pro-gold-theme.js
// Resume with globalThis.goldQA = { spaceId, outputDir }.
const { strict: assert } = await import('node:assert')
const { mkdir } = await import('node:fs/promises')
const config = globalThis.goldQA ?? {}
const task = await taskSpace(config.spaceId ?? 'PRO gold theme QA')
const page = task.page('p1')
const directory = config.outputDir ?? '/tmp/selection-pro-gold'
await mkdir(directory, { recursive: true })
await page.goto('http://127.0.0.1:5187/playground.html')
const previous = await page.evaluate(() => ({
  component: localStorage.getItem('playground-selected-component'), theme: localStorage.getItem('craft-theme'),
}))
const results = []
try {
  await page.click('loc=role:button[name="NORM / PRO 导航与草稿"]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(match => match[1]).find(url => url.includes('/i18n/'))
    await (await import(url)).i18n.changeLanguage('zh-Hans')
  })
  for (const [theme, expected, shadow, blue] of [['Light', [139, 85, 39], '97, 60, 27', [29, 78, 216]], ['Dark', [210, 173, 118], '147, 121, 83', [96, 165, 250]]]) {
    await page.click('[data-work-mode-preview] button:text-is("NORM")')
    await page.click(`loc=role:button[name="${theme}"]`)
    await page.waitForFunction(theme => document.documentElement.classList.contains(theme.toLowerCase()), theme)
    const norm = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return ['--accent', '--accent-rgb', '--background', '--success', '--info', '--destructive'].map(key => style.getPropertyValue(key))
    })
    await page.click('[data-work-mode-preview] button:text-is("PRO")')
    await page.click('loc=role:button[name="打开 PRO 子会话深链接"]')
    await page.waitForSelector('[data-work-mode-chat] a[href="https://example.com/costs"]')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-work-mode-chat] button')].some(button => ['只读探索', '完全接管', '询问修改'].includes(button.textContent)))
    const permissionLabel = await page.evaluate(() => [...document.querySelectorAll('[data-work-mode-chat] button')].find(button => ['只读探索', '完全接管', '询问修改'].includes(button.textContent)).textContent)
    await page.click(`loc=role:button[name="${permissionLabel}"]`)
    await page.waitForSelector('[data-tutorial="permission-mode-allow-all"]')
    await page.click('[data-tutorial="permission-mode-allow-all"]')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-work-mode-chat] button')].some(button => button.textContent === '完全接管'))
    const readColors = label => page.evaluate(label => {
      const root = document.documentElement, style = getComputedStyle(root)
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const rgb = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data] }
      const blend = (foreground, background) => foreground.slice(0, 3).map((value, i) => value * foreground[3] / 255 + background[i] * (1 - foreground[3] / 255))
      const luminance = values => values.slice(0, 3).reduce((sum, v, i) => { v /= 255; return sum + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i] }, 0)
      const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
      const permission = [...document.querySelectorAll('[data-work-mode-chat] button')].find(button => button.textContent === label)
      const permissionStyle = getComputedStyle(permission), backdrop = rgb(getComputedStyle(document.querySelector('[data-work-mode-preview]')).backgroundColor)
      const badge = document.querySelector('.session-mode-badge'), badgeStyle = getComputedStyle(badge)
      const link = document.querySelector('[data-work-mode-chat] a[href="https://example.com/costs"]')
      return { mode: root.dataset.workMode, accent: rgb(style.getPropertyValue('--accent')).slice(0, 3), shadow: style.getPropertyValue('--accent-rgb').trim(),
        semantics: ['--background', '--success', '--info', '--destructive'].map(key => style.getPropertyValue(key)),
        permission: rgb(permissionStyle.color).slice(0, 3), link: rgb(getComputedStyle(link).color).slice(0, 3),
        badge: rgb(badgeStyle.color).slice(0, 3), badgeBorder: rgb(badgeStyle.borderColor).slice(0, 3), badgeBackgroundAlpha: rgb(badgeStyle.backgroundColor)[3],
        permissionContrast: contrast(rgb(permissionStyle.color), blend(rgb(permissionStyle.backgroundColor), backdrop)),
        linkContrast: contrast(rgb(getComputedStyle(link).color), backdrop),
        fits: permission.getBoundingClientRect().right <= document.querySelector('[data-work-mode-chat]').getBoundingClientRect().right }
    }, label)
    const result = await readColors('完全接管')
    assert.equal(result.mode, 'PRO')
    for (const key of ['accent', 'permission', 'link']) assert.deepEqual(result[key], expected, `${theme} ${key} uses Binchael gold`)
    assert.equal(result.shadow, shadow)
    assert.deepEqual(result.semantics, norm.slice(2))
    assert.deepEqual(result.badge, expected)
    assert.deepEqual(result.badgeBorder, expected)
    assert.equal(result.badgeBackgroundAlpha, 0)
    assert.ok(result.permissionContrast >= 4.5 && result.linkContrast >= 4.5)
    assert.ok(result.fits)
    await page.click('loc=role:button[name="完全接管"]')
    await page.waitForSelector('[data-tutorial="permission-mode-allow-all"]')
    assert.equal(await page.evaluate(() => {
      const item = document.querySelector('[data-tutorial="permission-mode-allow-all"]')
      return !item.closest('[data-work-mode-preview]') && getComputedStyle(item).getPropertyValue('--accent') === getComputedStyle(document.documentElement).getPropertyValue('--accent')
    }), true, 'body portal inherits the PRO accent')
    await page.keyboard.press('Escape')
    const clip = await page.evaluate(() => { const r = document.querySelector('[data-work-mode-preview]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
    await page.screenshot({ path: `${directory}/pro-gold-${theme.toLowerCase()}.png`, clip })
    await page.click('loc=role:button[name="完全接管"]')
    await page.click('[data-tutorial="permission-mode-ask"]')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-work-mode-chat] button')].some(button => button.textContent === '询问修改'))
    const ask = await readColors('询问修改')
    assert.deepEqual(ask.permission, blue)
    assert.deepEqual(ask.accent, expected)
    assert.ok(ask.permissionContrast >= 4.5)
    await page.screenshot({ path: `${directory}/pro-ask-${theme.toLowerCase()}.png`, clip })
    await page.click('xpath=//label[text()="compactInput"]/../following-sibling::button')
    await page.waitForSelector('[data-work-mode-chat] button[aria-label^="权限模式"]')
    const compactAsk = await readColors('询问修改')
    assert.deepEqual(compactAsk.permission, blue)
    assert.ok(compactAsk.permissionContrast >= 4.5 && compactAsk.fits)
    await page.click('[data-work-mode-chat] button[aria-label^="权限模式"]')
    await page.waitForSelector('[role="dialog"]')
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"]')).getPropertyValue('--permission-ask') === getComputedStyle(document.documentElement).getPropertyValue('--permission-ask')), true)
    await page.keyboard.press('Escape')
    await page.click('xpath=//label[text()="compactInput"]/../following-sibling::button')
    await page.waitForSelector('[data-work-mode-chat] [data-tutorial="permission-mode-dropdown"]')
    await page.click('[data-work-mode-preview] button:text-is("NORM")')
    assert.deepEqual(await page.evaluate(() => { const style = getComputedStyle(document.documentElement); return ['--accent', '--accent-rgb', '--background', '--success', '--info', '--destructive'].map(key => style.getPropertyValue(key)) }), norm)
    assert.equal(await page.evaluate(() => { const style = getComputedStyle(document.documentElement); return style.getPropertyValue('--permission-ask').trim() === style.getPropertyValue('--info').trim() }), true)
    results.push({ theme, ...result, ask: { color: ask.permission, contrast: ask.permissionContrast }, compactAsk: { color: compactAsk.permission, contrast: compactAsk.permissionContrast } })
  }
  // Same cascade as ThemeProvider's dynamically injected preset stylesheet.
  await page.evaluate(() => { const style = document.createElement('style'); style.id = 'pro-gold-qa-preset'; style.textContent = ':root { --accent: #123456; --accent-rgb: 1, 2, 3; }'; document.head.append(style) })
  await page.click('[data-work-mode-preview] button:text-is("PRO")')
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()), '147, 121, 83')
  await page.click('[data-work-mode-preview] button:text-is("NORM")')
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()), '1, 2, 3')
  console.log({ passed: true, presetCascade: true, results, outputDir: directory })
} finally {
  await page.evaluate(previous => {
    document.getElementById('pro-gold-qa-preset')?.remove()
    for (const [key, value] of [['playground-selected-component', previous.component], ['craft-theme', previous.theme]]) {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value)
    }
  }, previous)
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
