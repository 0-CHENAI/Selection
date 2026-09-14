import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const preview = new URL('../../apps/electron/src/renderer/thought-canvas-narrow-preview.html', import.meta.url)
const out = new URL('./thought-workbench-narrow-layout.json', import.meta.url)

async function measure(page, label, url) {
  await page.setViewportSize({ width: 800, height: 700 })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const metrics = await page.evaluate(() => {
    const split = document.querySelector('[data-testid="thought-canvas-split"]')
    const stage = document.querySelector('[data-testid="thought-canvas-stage"]')
    const editor = document.querySelector('[data-testid="thought-canvas-editor"]')
    const box = (el) => {
      const rect = el.getBoundingClientRect()
      return {
        height: Math.round(rect.height),
        width: Math.round(rect.width),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
      }
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      split: { ...box(split), scrollHeight: split.scrollHeight, clientHeight: split.clientHeight },
      stage: box(stage),
      editor: box(editor),
    }
  })
  await page.screenshot({
    path: new URL(`./thought-workbench-narrow-${label}.png`, import.meta.url).pathname,
    fullPage: true,
  })
  return metrics
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const uri = pathToFileURL(new URL(preview).pathname).href
const legacy = await measure(page, 'legacy', `${uri}?legacy=1`)
const current = await measure(page, 'current', uri)
await browser.close()

const report = {
  viewport: '800x700',
  legacy,
  current,
  legacyEditorCrushed: legacy.editor.height < 80,
  currentEditorUsable: current.editor.height >= 320,
  currentStageBounded: current.stage.height <= 280,
}
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.currentEditorUsable || !report.currentStageBounded) {
  console.error('FAIL: current 800x700 layout still starves the editor')
  process.exit(1)
}
