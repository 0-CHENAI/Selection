/** Reproducible Selection adaptations; never changes the imported source decks or existing templates. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkDeck } from '../apps/electron/resources/skills/ppt-design/engine/check'
import type { Deck } from '../apps/electron/resources/skills/ppt-design/engine/types'

const root = resolve(import.meta.dir, '../apps/electron/resources/skills/ppt-design/styles')
export const addedDshTemplates = ['dsh-monochrome', 'dsh-blue-professional', 'dsh-neo-grid-bold', 'swiss-signal-grid', 'dsh-signal', 'dsh-broadside', 'dsh-playful', 'dsh-sakura-chroma', 'modular-logistics-system', 'nordic-operating-report', 'dsh-editorial-forest']
/** Default-picker packs from the first DSH import whose Chinese source page leaves a single character on its last line. */
export const adaptedFirstDshTemplates = ['dsh-course-workshop', 'dsh-engineering-blueprint']

function adapt(deck: Deck, slug: string): void {
  for (const page of deck.pages) {
    for (const element of page.elements) {
      if (slug === 'dsh-course-workshop' && page.id === '03' && element.id === 't7' && element.text === '从引导练习走向独立完成') element.text = '从引导练习\n走向独立完成'
      if (slug === 'dsh-engineering-blueprint' && page.id === '03' && element.id === 't101' && element.text === '明确每一层边界') element.text = '明确\n每一层边界'
      if (slug === 'dsh-sakura-chroma' && page.id === '12' && ['s3', 's4', 's5'].includes(element.id)) element.role = 'decoration' // rotated background ribbons behind the closing label
      if (slug === 'nordic-operating-report' && page.id === '03' && element.id === 'scale-current') element.font!.color = '#086A80'
      if (slug === 'dsh-broadside' && (page.id === '01' && ['t3', 't4'].includes(element.id) || page.id === '12' && ['t2', 't3'].includes(element.id) || page.id === '06' && element.id === 't10')) element.font!.color = '#181915'
      if (slug === 'dsh-broadside' && page.id === '06' && element.id === 't14') element.font!.color = '#FDFCF9'
      if ((slug === 'dsh-monochrome' && page.id === '03' && element.id === 't7' || slug === 'dsh-sakura-chroma' && page.id === '05' && element.id === 't10') && element.text?.startsWith('Clear first step.')) { element.text = 'Clear first step.\nUnclear\nhandoff.'; element.textCapacity!.maxLines = 3 }
      if (slug === 'dsh-playful' && page.id === '02' && element.id === 't8') {
        element.text = element.text!.startsWith('Invite') ? 'Invite one small\naction, then let the\nresult inspire\nthe next one.' : '邀请用户完成\n一个小行动，\n再用结果激发下一步。'
        element.textCapacity!.maxLines = 4
      }
      if (slug === 'modular-logistics-system') {
        if (page.id === '01' && element.id === 'p01-route-line-04') { element.bounds.y = 215; element.bounds.h = 39; element.line!.points!.y2 = 39 }
        if (page.id === '09') {
          if (['p09-grid-v', 'p09-grid-h'].includes(element.id)) element.role = 'decoration' // dashed reference grid behind the positioned options
          if (element.id.startsWith('p09-option-site')) { element.bounds.x += 24; element.bounds.y += 26 }
          if (element.id.startsWith('p09-option-local')) element.bounds.y -= 14
          const connectors: Record<string, [number, number, number, number]> = { 'p09-path-01': [288, 350, 294, 337], 'p09-path-02': [425, 292, 425, 288], 'p09-path-03': [520, 226, 520, 224] }
          const points = connectors[element.id]
          if (points) { const [x1,y1,x2,y2] = points; element.bounds = { x: Math.min(x1,x2), y: Math.min(y1,y2), w: Math.max(1,Math.abs(x2-x1)), h: Math.max(1,Math.abs(y2-y1)) }; element.line!.points = { x1: x1-element.bounds.x, y1: y1-element.bounds.y, x2: x2-element.bounds.x, y2: y2-element.bounds.y } }
        }
        if (page.id === '10' && element.id === 't37') { element.bounds.y = 380; element.bounds.w = 70 }
      }
    }
  }
  // Preserve words, font size and content. Rebalance only diagnosed text blocks.
  for (const issue of checkDeck(deck)) {
    if (issue.code !== 'orphan' && issue.code !== 'over_capacity') continue
    const page = deck.pages.find(page => page.id === issue.pageId)!
    const element = page.elements.find(element => element.id === issue.elementId)!
    if (!element.text || !element.font) continue
    const original = element.text
    const width = element.bounds.w
    const clean = () => !checkDeck(deck).some(item => item.pageId === page.id && item.elementId === element.id && (item.code === 'orphan' || item.code === 'over_capacity' || item.code === 'overlap'))
    let fixed = false
    // Explicit line breaks, preferably at spaces; no shortened facts or smaller type.
    const flat = original.replace(/\n/g, ' ')
    const points = Array.from({ length: flat.length - 1 }, (_, index) => index + 1).sort((a, b) => Math.abs(a - flat.length / 2) - Math.abs(b - flat.length / 2))
    for (const index of points) {
      if (!/[\u3400-\u9fff]/.test(flat) && flat[index] !== ' ') continue
      element.text = `${flat.slice(0, index).trimEnd()}\n${flat.slice(index).trimStart()}`
      if (clean()) { fixed = true; break }
    }
    if (!fixed) {
      element.text = original
      for (let shrink = 1; shrink <= 12; shrink++) {
        element.bounds.w = width - shrink
        if (clean()) { fixed = true; break }
      }
    }
    if (!fixed) { element.text = original; element.bounds.w = width }
  }
}

if (import.meta.main) {
  const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8'))
  const record: unknown[] = []
  const outputs: { directory: string; file: string; content: string }[] = []
  for (const slug of [...addedDshTemplates, ...adaptedFirstDshTemplates]) {
    // Packs archived out of the picker keep their adapted pages under _archive/imported (not in the installer).
    const base = String(catalog[slug].deck).startsWith(`styles/_archive/imported/${slug}/`) ? '_archive/imported' : 'examples/imported'
    const directory = join(root, base, slug)
    for (const file of ['deck.json', 'deck.en.json']) {
      const deck = JSON.parse(readFileSync(join(root, slug, file), 'utf8')) as Deck
      const before = checkDeck(deck)
      adapt(deck, slug)
      const after = checkDeck(deck)
      if (after.length) throw new Error(`${slug}/${file}: ${JSON.stringify(after)}`)
      outputs.push({ directory, file, content: JSON.stringify(deck, null, 2) + '\n' })
      record.push({ slug, file, sourceIssues: before, remainingIssues: after })
      console.log(`${slug}/${file}: ${before.length} → ${after.length}`)
    }
    catalog[slug].deck = `styles/${base}/${slug}/deck.json`
    catalog[slug].deckEn = `styles/${base}/${slug}/deck.en.json`
  }
  // A failed later pack must not leave earlier adapted decks regenerated without diagnostics.
  for (const { directory, file, content } of outputs) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, file), content)
  }
  writeFileSync(join(root, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
  writeFileSync(join(root, 'dsh-import-diagnostics.json'), JSON.stringify({ sourceCommit: '8dec631777c34fbbcc7d45af787bdd2c468d2cfb', adaptations: record }, null, 2) + '\n')
}
