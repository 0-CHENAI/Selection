/**
 * 图片位：模板或版式里需要放一张真实照片的位置。
 *
 * 规则（LinNai，2026-11）：用户给了图片才用带图片位的页面；没给图片就选没有图片位的页面，
 * 成稿里不留空占位，也不留模板样例照片。占位框只是最后手段。
 *
 * 三种来源：
 * - 模板样例照片：`styles/examples/_assets/*.jpg`（不透明照片；透明 PNG 是插画和装饰，不算）。
 * - 结构版式的虚线框：id 形如 `*-picture-*-carrier` 的形状。
 * - 页面 `imageSlots` 合同里声明的槽，以及 `placeholder:` / `selection-placeholder-*.png` 占位。
 */
import type { Deck, DeckElement, DeckPage } from './types.ts'

const SAMPLE_PHOTO = /(?:^|[/\\])styles[/\\](?:_archive[/\\])?examples[/\\]_assets[/\\][^/\\]+\.jpe?g$/i
const PLACEHOLDER = /(?:^|[/\\])selection-placeholder-[^/\\]+\.png$/i

export function isPlaceholderImageSrc(src: string | undefined): boolean {
  if (!src) return false
  return src.startsWith('placeholder:') || PLACEHOLDER.test(src)
}

/** 模板自带的样例照片。成稿里出现说明图片位还没换成用户的图。 */
export function isSamplePhotoSrc(src: string | undefined): boolean {
  return !!src && SAMPLE_PHOTO.test(src)
}

export function isPictureCarrier(element: DeckElement): boolean {
  return element.type === 'shape' && /(?:^|-)picture(?:-[a-z0-9]+)*-carrier$/i.test(element.id)
}

/** 这一页的图片位元素 id。 */
export function pictureSlotIds(page: DeckPage): string[] {
  const declared = new Set(page.imageSlots?.slots.map(slot => slot.elementId) ?? [])
  return page.elements
    .filter(element => declared.has(element.id)
      || isPictureCarrier(element)
      || (element.type === 'image' && !element.chartImage && (isSamplePhotoSrc(element.src) || isPlaceholderImageSrc(element.src))))
    .map(element => element.id)
}

/** 有图片位的页码（从 1 开始），写进 catalog 的 `pictureSlotPages`。 */
export function pictureSlotPages(deck: Pick<Deck, 'pages'>): number[] {
  return deck.pages.flatMap((page, index) => pictureSlotIds(page).length > 0 ? [index + 1] : [])
}
