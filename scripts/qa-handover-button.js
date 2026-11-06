// #793: header trigger only opens historical source/target associations.
// Mode-switch handover create is removed; this script must not mint a session.
// Start: bun x vite --config apps/electron/vite.config.ts --host 127.0.0.1 --port 5187 --strictPort
// Check: ego-browser nodejs < scripts/qa-handover-button.js
// To resume a space, prefix with globalThis.handoverQA = { spaceId, url, outputDir }.
const { strict: assert } = await import('node:assert')
const config = globalThis.handoverQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Handover association QA')
const page = task.page(config.page ?? 'p1')
await page.goto(config.url ?? 'http://127.0.0.1:5187/playground.html')
try {
  await page.evaluate(() => { localStorage.setItem('playground-selected-component', 'session-handover') })
  await page.reload()
  await page.waitForSelector('[data-handover-trigger]')
  await page.evaluate(async () => {
    const entry = await (await fetch('/playground.tsx')).text()
    const url = [...entry.matchAll(/from "([^"]+)"/g)].map(m => m[1]).find(u => u.includes('/i18n/'))
    if (!url) throw new Error('Vite i18n import missing')
    await (await import(url)).i18n.changeLanguage('zh-Hans')
  })
  const state = () => page.evaluate(() => {
    const button = document.querySelector('[data-handover-trigger]')
    return {
      label: button?.getAttribute('aria-label'),
      text: button?.textContent,
      source: document.querySelector('[data-handover-title]')?.textContent,
      disabled: button?.disabled,
      dialog: !!document.querySelector('[role=dialog]'),
      records: document.querySelector('[data-handover-record-count]')?.textContent,
      sessionId: document.querySelector('[data-handover-session]')?.dataset.handoverSession,
    }
  })
  async function close() {
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  }
  const initial = await state()
  assert.equal(initial.label, '查看交接')
  assert.ok(initial.text.includes('查看交接'))
  assert.equal(initial.source, '成本分析')
  assert.equal(initial.records, '交接记录：1')
  assert.equal(initial.dialog, false)
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog]')
  const open = await state()
  assert.equal(open.dialog, true)
  assert.equal(open.sessionId, 'norm-analysis')
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].some(button =>
    button.textContent === '交接到 PRO' || button.textContent === '创建新的交接' || button.textContent === '下次不再显示'
  )), false, 'mode-switch create controls must not appear')
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].some(button =>
    button.textContent === '打开目标会话' || button.textContent === '打开源会话'
  )), true, 'source/target links must remain')
  await close()
  await page.click('[data-handover-trigger]')
  await page.waitForSelector('[role=dialog]')
  await page.click('[role=dialog] button:text-is("打开目标会话")')
  await page.waitForFunction(() => document.querySelector('[data-handover-session]')?.dataset.handoverSession !== 'norm-analysis')
  assert.equal((await state()).source, '成本核对')
  console.log({ passed: true, viewOnly: true, seededAssociation: true, noCreate: true, openTarget: true })
} finally {
  await page.reload()
}
if (!config.spaceId) await task.finish({ keep: [] })
