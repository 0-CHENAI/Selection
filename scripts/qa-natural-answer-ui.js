// Replays real natural-v1 event streams through the production renderer
// processor, turn grouping and TurnCard, sampling layout every frame.
// Start Electron Vite (bun run electron:dev), capture events with
//   QA_DUMP=/tmp/natural-events.json bun run scripts/qa-natural-answer.ts
// then: ego-browser nodejs < scripts/qa-natural-answer-ui.js
// Optional globalThis.naturalAnswerQA = { spaceId, dump, speed, shots, finish }.
const config = globalThis.naturalAnswerQA ?? {}
const fs = await import('node:fs')
const dumps = JSON.parse(fs.readFileSync(config.dump ?? '/tmp/natural-events.json', 'utf8'))
const task = await taskSpace(config.spaceId ?? '自然收尾答案 UI 回放')
console.log({ spaceId: task.spaceId })
const page = task.page('p1')
await page.goto('http://localhost:5173/playground.html')
await page.waitForSelector('#root > *')
const results = []
for (const [index, dump] of dumps.entries()) {
  await page.evaluate(({ dump, speed, probeAt, traceWindow }) => {
    window.__naturalQA = null
    void (async () => {
      const urls = performance.getEntriesByType('resource').map(e => e.name)
      const reactUrl = urls.find(u => /\/react\.js\?/.test(u))
      const React = (await import(reactUrl)).default
      const { flushSync } = (await import(reactUrl.replace('/react.js?', '/react-dom.js?'))).default
      const { createRoot } = (await import(urls.find(u => /\/react-dom_client\.js\?/.test(u)))).default
      const base = urls.find(u => u.includes('/apps/electron/node_modules/')).split('/apps/electron/')[0]
      const { TurnCard } = await import(`${base}/packages/ui/src/components/chat/TurnCard.tsx`)
      const { groupMessagesByTurn } = await import(`${base}/packages/ui/src/components/chat/turn-utils.ts`)
      const { processEvent } = await import(`${base}/apps/electron/src/renderer/event-processor/processor.ts`)
      document.getElementById('natural-qa-host')?.remove()
      const host = document.createElement('div')
      host.id = 'natural-qa-host'
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--background);overflow:auto;padding:24px'
      document.body.append(host)
      const mount = document.createElement('div')
      mount.style.width = '720px'
      host.append(mount)
      const root = createRoot(mount)
      const sessionId = dump.events.find(e => e.sessionId)?.sessionId ?? 'qa'
      let state = { session: { id: sessionId, workspaceId: 'w', workspaceName: 'W', messages: [], isProcessing: true, lastMessageAt: 0 }, streaming: null }
      // Stable callbacks, as ChatDisplay provides; new lambdas would remount Markdown.
      const noop = () => {}
      const render = () => flushSync(() => root.render(React.createElement('div', null,
        groupMessagesByTurn(state.session.messages, { isSessionProcessing: state.session.isProcessing })
          .filter(turn => turn.type === 'assistant')
          .map(turn => React.createElement(TurnCard, {
            key: turn.turnId, sessionId, turnId: turn.turnId, activities: turn.activities, response: turn.response,
            intent: turn.intent, isStreaming: turn.isStreaming, isComplete: turn.isComplete, todos: turn.todos,
            isLastResponse: true, onRegenerate: noop, onOpenFile: noop, onOpenUrl: noop,
          })))))
      const samples = []
      let sampling = true
      const t0 = performance.now()
      const sample = () => {
        if (!sampling) return
        const note = null
        const card = mount.querySelector('[data-response-kind="response"]')
        samples.push({
          t: performance.now() - t0,
          height: mount.getBoundingClientRect().height,
          note: note ? note.getBoundingClientRect().height : 0,
          noteOpacity: note ? Number(getComputedStyle(note.closest('.select-text') ?? note).opacity) : 0,
          card: card ? card.getBoundingClientRect().height : 0,
          cardText: card ? (card.querySelector('.markdown-content')?.textContent ?? '').length : 0,
          placeholder: !!mount.querySelector('[data-streaming-block-placeholder]'),
          blocks: [...mount.querySelectorAll('[data-response-kind="response"]')].map(el => Math.round(el.closest('.select-text')?.getBoundingClientRect().height ?? -1) + '@' + (getComputedStyle(el.closest('.select-text') ?? el).opacity.slice(0,4))).join(',') + '|chrome=' + Math.round(mount.querySelector('.group.select-none')?.getBoundingClientRect().height ?? 0),
        })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      if (probeAt) setTimeout(() => {
        const first = mount.querySelector('[data-response-kind="response"] [data-stream-chunk]')
        if (first) first.setAttribute('data-probe-mark', '1')
      }, probeAt - 150)
      if (probeAt) setTimeout(() => {
        const card = mount.querySelector('[data-response-kind="response"] .markdown-content')
        window.__naturalProbeSameNode = !!mount.querySelector('[data-probe-mark]')
        window.__naturalProbe = card ? [...card.querySelectorAll('[data-stream-chunk],p,li')].slice(0, 12).map(el => ({
          tag: el.tagName, text: (el.textContent ?? '').slice(0, 16), cls: el.className, clip: el.style.clipPath,
          opacity: getComputedStyle(el).opacity, anims: el.getAnimations().map(a => [a.playState, Math.round(a.currentTime ?? -1)]),
          top: Math.round(el.getBoundingClientRect().top), innerH: window.innerHeight,
        })) : 'no card'
      }, probeAt)
      const start = dump.events[0]?.at ?? 0
      const marks = {}
      for (const event of dump.events) {
        const due = (event.at - start) / speed
        const wait = due - (performance.now() - t0)
        if (wait > 0) await new Promise(r => setTimeout(r, wait))
        state = processEvent(state, event).state
        if (event.type === 'complete') state = { ...state, session: { ...state.session, isProcessing: false } }
        render()
        if (event.type === 'text_complete' && event.answerCommitted) marks.commit = performance.now() - t0
        if (event.type === 'tool_start' && marks.firstTool == null) marks.firstTool = performance.now() - t0
        if (event.type === 'text_complete' && event.isIntermediate && event.text?.trim()) (marks.merges ??= []).push(Math.round(performance.now() - t0))
      }
      await new Promise(r => setTimeout(r, 900))
      sampling = false
      // Height regressions: frames where the turn got shorter.
      const drops = []
      for (let i = 1; i < samples.length; i++) {
        const d = samples[i - 1].height - samples[i].height
        const t = samples[i].t
        if (d > 0.5) drops.push({ t: Math.round(t), d: Math.round(d * 10) / 10, note: (marks.merges ?? []).some(m => t >= m && t - m < 700) })
      }
      let cardAppearances = 0, cardDisappearances = 0
      for (let i = 1; i < samples.length; i++) {
        if (!samples[i - 1].card && samples[i].card) cardAppearances++
        if (samples[i - 1].card && !samples[i].card) cardDisappearances++
      }
      const finalCard = mount.querySelector('[data-response-kind="response"] .markdown-content')?.textContent ?? ''
      window.__naturalQA = {
        frames: samples.length,
        marks,
        maxNoteHeight: Math.max(0, ...samples.map(s => s.note)),
        noteFrames: samples.filter(s => s.note > 0).length,
        cardAppearances, cardDisappearances,
        totalDrop: Math.round(drops.reduce((a, b) => a + b.d, 0)),
        maxFrameDrop: Math.max(0, ...drops.map(d => d.d)),
        dropsOutsideNoteExit: drops.filter(d => !d.note).length,
        drops: drops.slice(0, 40),
        finalHeight: Math.round(samples.at(-1)?.height ?? 0),
        finalCardChars: finalCard.length,
        trace: traceWindow ? samples.filter(x => x.t >= traceWindow[0] && x.t <= traceWindow[1]).map(x => [Math.round(x.t), Math.round(x.height), Math.round(x.card), x.blocks]) : undefined,
        replyBlocksLeft: mount.querySelectorAll('[data-response-kind="response"]').length,
        visibility: document.visibilityState, placeholderFrames: samples.filter(s => s.placeholder).length,
      }
    })().catch(e => { window.__naturalQA = { error: String(e), stack: e.stack } })
  }, { dump, speed: config.speed ?? 1, probeAt: config.probeAt, traceWindow: config.trace })
  if (config.shots) {
    let last = 0
    for (const [n, at] of config.shots.entries()) {
      await page.waitForTimeout(at - last); last = at
      await page.screenshot({ path: `/tmp/natural-qa-${index}-${n}.png` })
    }
  }
  await page.waitForFunction(() => window.__naturalQA, undefined, { timeout: 120000 })
  const result = await page.evaluate(() => window.__naturalQA)
  if (config.probeAt) console.log(JSON.stringify(await page.evaluate(() => ({ sameNode: window.__naturalProbeSameNode, probe: window.__naturalProbe })), null, 0))
  await page.screenshot({ path: `/tmp/natural-qa-${index}-final.png` })
  results.push({ model: dump.model, prompt: dump.prompt.slice(0, 16), ...result })
  console.log(JSON.stringify(results.at(-1)))
  if (result.error) break
}
if (config.finish !== false) await task.finish({ keep: [] })
