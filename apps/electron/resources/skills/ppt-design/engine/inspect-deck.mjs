// Read-only, bounded template inspection. Original JSON remains the source of truth.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectDeck(file, start = 1, count = 6) {
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error('start 必须为正整数，count 必须在 1–12 之间')
  }
  const source = resolve(file)
  const deck = JSON.parse(readFileSync(source, 'utf8'))
  if (!Array.isArray(deck.pages)) throw new Error('输入不是含 pages 数组的 deck JSON')
  const short = value => typeof value === 'string' ? value.slice(0, 160) : undefined
  return {
    source, lossy: true, title: short(deck.title), totalPages: deck.pages.length,
    start, nextStart: start - 1 + count < deck.pages.length ? start + count : undefined,
    limitations: '仅用于选页，不是完整事实或编辑依据。文字经过截断；样式、坐标、图表数据、备注和来源须按 pages[index] 回查原始 JSON。不要把参考稿的事实替换成用户事实。',
    pages: deck.pages.slice(start - 1, start - 1 + count).map((page, offset) => {
      const elements = Array.isArray(page.elements) ? page.elements : []
      const types = new Map()
      for (const element of elements) {
        const type = ['text', 'shape', 'image', 'chart', 'table', 'group', 'line'].includes(element.type) ? element.type : 'other'
        types.set(type, (types.get(type) ?? 0) + 1)
      }
      return {
        page: start + offset, sourcePath: `pages[${start + offset - 1}]`,
        id: short(page.id), name: short(page.name), layout: short(page.layout),
        elements: elements.length, types: Object.fromEntries(types),
        textSamples: elements.filter(e => e.type === 'text').slice(0, 3).map(e => short(e.text)),
      }
    }),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [file, start, count, ...extra] = process.argv.slice(2)
    if (!file || extra.length) throw new Error('用法：inspect-deck.mjs <deck.json> [start=1] [count=6，最多12]')
    console.log(JSON.stringify(inspectDeck(file, start === undefined ? 1 : Number(start), count === undefined ? 6 : Number(count))))
  } catch (error) {
    console.error(JSON.stringify({ status: 'error', message: error.message }))
    process.exitCode = 1
  }
}
