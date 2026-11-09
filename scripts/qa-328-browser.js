// Replay incremental output against the real renderer for #328.
// Example: playwright-cli -s=qa open http://localhost:5173/playground.html
//          playwright-cli -s=qa run-code "$(< scripts/qa-328-browser.js)"
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
    const { Markdown } = await import(workspace + '/packages/ui/src/components/markdown/Markdown.tsx')
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
      host, root, animations, wait,
      async markdown(props) {
        root.render(R.createElement(R.StrictMode, null, R.createElement(Markdown, props)))
        await wait()
      },
      restore() { Element.prototype.animate = original },
    }
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const result = await page.evaluate(async () => {
    const q = window.__issueQA
    const assert = (ok, message) => { if (!ok) throw new Error(message) }
    const id = 'incremental-' + Date.now()
    q.host.style.width = '600px'
    let text = '起始段落。'
    await q.markdown({ id, isStreaming: true, children: text })
    const paragraph = q.host.querySelector('p')
    const initial = q.animations.length
    for (let i = 0; i < 10; i++) {
      text += '同一段落持续增加内容 mixed English，旧行保持稳定。'.repeat(5)
      await q.markdown({ id, isStreaming: true, children: text })
    }
    const growth = q.animations.slice(initial)
    assert(growth.length > 5, 'growing paragraph lacks incremental reveal')
    assert(q.host.querySelector('p') === paragraph, 'growing paragraph was remounted')
    assert(growth.every(a => a.frames[0].clipPath && a.frames[0].clipPath !== 'inset(0 0 100% 0)' && a.frames[0].opacity === undefined), 'old lines faded or hidden again')
    const beforeKey = q.animations.length
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    text += '\n\n新增段落。'
    q.host.scrollTop = q.host.scrollHeight
    await q.markdown({ id, isStreaming: true, children: text })
    q.host.scrollTop = q.host.scrollHeight
    await q.wait(); await q.wait()
    assert(q.animations.length > beforeKey, 'ordinary key disabled future paragraphs')
    // A new message with content initially below its actual scroll viewport.
    q.host.style.height = '220px'; q.host.style.bottom = 'auto'; q.host.scrollTop = 0
    const offId = id + '-viewport'
    const offText = '上方占位长段落。'.repeat(300) + '\n\n刚生成的底部段落。'
    await q.markdown({ id: offId, isStreaming: true, children: offText })
    const bottom = q.host.querySelectorAll('p')[1]
    assert(bottom.style.clipPath !== '', 'offscreen content was incorrectly marked shown')
    const beforeView = q.animations.length
    q.host.scrollTop = q.host.scrollHeight
    await q.wait(); await q.wait(); await q.wait()
    assert(q.animations.slice(beforeView).some(a => a.element === bottom), 'viewport entry did not reveal pending paragraph')
    assert(bottom.style.clipPath === '', 'pending clip not removed')
    // A burst larger than the per-frame measurement budget still reveals its
    // newest visible tail after auto-follow reaches the bottom.
    const burst = Array.from({ length: 100 }, (_, i) => `批量段落 ${i}。`).join('\n\n')
    q.host.scrollTop = 0
    await q.markdown({ id: id+'-burst', isStreaming: true, children: burst })
    const tail = q.host.querySelectorAll('p')[99]
    const beforeTail = q.animations.length
    q.host.scrollTop = q.host.scrollHeight
    await q.wait(); await q.wait(); await q.wait()
    assert(q.animations.slice(beforeTail).some(a => a.element === tail), 'fast burst lost tail reveal')
    const range = document.createRange(); range.selectNodeContents(q.host)
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    assert(window.getSelection().toString().includes('批量段落 99'), 'full text not selectable')
    assert(q.animations.every(a => a.animation.playState !== 'running'), 'selection did not expose full content')
    window.getSelection().removeAllRanges()
    q.host.style.height = ''; q.host.style.bottom = '32px'; q.host.scrollTop = 0
    const richId = id + '-rich'
    const rich = '# 标题\n\n- 列表一\n- 列表二\n\n> 引用\n\n```text\ncode line one\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |'
    await q.markdown({ id: richId, isStreaming: true, children: rich })
    const heading=q.host.querySelector('h1'), row=q.host.querySelector('tbody tr'), code=q.host.querySelector('[data-ca-block-type=code]')
    await q.markdown({ id: richId, isStreaming: true, children: rich+'\n| 3 | 4 |\n\n尾段。' })
    assert(q.host.querySelector('h1') === heading && q.host.querySelector('tbody tr') === row && q.host.querySelector('[data-ca-block-type=code]') === code, 'rich blocks remounted')
    // Syntax highlighting may finish after the React commit. The stable outer
    // code unit must animate appended lines without replaying the whole block.
    const codeId = id + '-code'
    let codeSource = '```text\nfirst line\n```'
    await q.markdown({ id: codeId, isStreaming: true, children: codeSource })
    await q.wait()
    const codeRoot = q.host.querySelector('[data-ca-block-type=code]')
    const beforeCode = q.animations.length
    codeSource = '```text\nfirst line\nsecond line\nthird line\n```'
    await q.markdown({ id: codeId, isStreaming: true, children: codeSource })
    await q.wait(); await q.wait()
    assert(q.host.querySelector('[data-ca-block-type=code]') === codeRoot, 'code wrapper remounted')
    assert(q.animations.slice(beforeCode).some(a => a.element === codeRoot && a.frames[0].clipPath && a.frames[0].clipPath !== 'inset(0 0 100% 0)'), 'async code growth lacks appended-line reveal')
    await q.markdown({ id: richId, isStreaming: true, children: rich+'\n| 3 | 4 |\n\n尾段。' })
    const beforeComplete = q.animations.length
    await q.markdown({ id: richId, isStreaming: false, children: rich+'\n| 3 | 4 |\n\n尾段。', revealStartTime: Date.now() })
    assert(q.animations.length === beforeComplete, 'completion replayed content')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert(q.animations.every(a => a.animation.playState !== 'running'), 'completion kept visual backlog')
    await q.markdown({ id: richId+'-history', children: rich, revealStartTime: 1 })
    assert(q.animations.length === beforeComplete, 'history replayed')
    await q.markdown({ id: richId, isStreaming: true, children: rich })
    assert(q.animations.length === beforeComplete, 'revisited streaming message replayed old content')
    await q.markdown({ id: richId, isStreaming: true, children: rich+'\n\n恢复后新增段落。' })
    assert(q.animations.length > beforeComplete, 'resumed stream did not reveal new paragraphs')
    return { growthAnimations: growth.length, stableParagraph: true, oldLinesOpaque: true, typing: true, viewportEntry: true, fastBurstTail: true, selection: true, richDOM: true, asyncCodeGrowth: true, completion: true, history: true, resume: true }
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(async () => {
    const q = window.__issueQA, before = q.animations.length
    await q.markdown({ id: 'reduced-' + Date.now(), isStreaming: true, children: '减少动态效果。'.repeat(300) })
    if (q.animations.length !== before) throw new Error('reduced motion animated')
    q.restore()
  })
  return { ...result, reducedMotion: true }
}
