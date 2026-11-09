/**
 * 把每套模板和结构版式的图片位页码写进 catalog 的 `pictureSlotPages`。
 * 选模板时据此判断：用户给了图片才用这些页；没给就只用其余页。
 *
 *   bun engine/picture-slot-catalog.ts          检查是否同步
 *   bun engine/picture-slot-catalog.ts --write  重写两个 catalog
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pictureSlotPages } from './picture-slots.ts'
import type { DeckPage } from './types.ts'

export const PICTURE_SLOT_CATALOGS = ['styles/catalog.json', 'layouts/catalog.json'] as const

type Entry = { deck?: string; pictureSlotPages?: number[]; [key: string]: unknown }

/** 返回按 deck 计算后的 catalog；deck 不在仓库里的条目原样保留。 */
export function computePictureSlotCatalog(root: string, catalogPath: string): Record<string, Entry> {
  const catalog = JSON.parse(readFileSync(join(root, catalogPath), 'utf8')) as Record<string, Entry>
  const next: Record<string, Entry> = {}
  for (const [id, entry] of Object.entries(catalog)) {
    const deckPath = entry.deck ? join(root, entry.deck) : ''
    if (!deckPath || !existsSync(deckPath)) {
      next[id] = entry
      continue
    }
    const deck = JSON.parse(readFileSync(deckPath, 'utf8')) as { pages: DeckPage[] }
    const { pictureSlotPages: _old, ...rest } = entry
    next[id] = { ...rest, pictureSlotPages: pictureSlotPages(deck) }
  }
  return next
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..')
  let stale = false
  for (const path of PICTURE_SLOT_CATALOGS) {
    const text = `${JSON.stringify(computePictureSlotCatalog(root, path), null, 2)}\n`
    if (text === readFileSync(join(root, path), 'utf8')) continue
    if (process.argv.includes('--write')) writeFileSync(join(root, path), text)
    else stale = true
    console.log(`${path}${process.argv.includes('--write') ? ' 已更新' : ' 需要更新'}`)
  }
  if (stale) process.exit(1)
}
