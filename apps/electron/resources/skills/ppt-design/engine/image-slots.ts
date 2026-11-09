/**
 * 图片槽合同的建议稿。只根据页面上已有的图片元素生成，不改入参。
 * 写回页面备注或 imageSlots 之前必须由用户确认。
 */
import type { DeckPage, ImageSlot, ImageSlotContract } from './types.ts'

const ASPECTS: Array<[ImageSlot['aspectRatio'], number]> = [
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
]

export const SAMPLE_IMAGE_STYLE: ImageSlotContract['style'] = {
  medium: '实拍或简洁插画',
  palette: '跟随当前模板的纸色、墨色和强调色',
  lighting: '均匀，没有强烈投影',
  tone: '克制，适合咨询或国企汇报',
  textTreatment: '图片内文字数量为 0',
  continuity: '全稿同一观察角度和色彩',
}

function nearestAspect(width: number, height: number): ImageSlot['aspectRatio'] {
  const ratio = height > 0 ? width / height : 1
  return ASPECTS.reduce((best, item) => Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best)[0]
}

/** One contract for the pictures already on the page. No pictures means no contract. */
export function proposeImageContract(page: DeckPage, style: ImageSlotContract['style'] = SAMPLE_IMAGE_STYLE): ImageSlotContract | undefined {
  const pictures = page.elements.filter(element => element.type === 'image' && !element.chartImage)
  if (!pictures.length) return undefined
  const texts = page.elements.filter(element => element.type === 'text').map(element => element.id).slice(0, 4)
  const slots: ImageSlot[] = pictures.slice(0, 16).map(element => ({
    elementId: element.id,
    role: element.alt?.trim() || '画面',
    contentSources: texts,
    sourcePolicy: 'contextual-scene',
    subject: element.alt?.trim() || '与本页标题相关的画面',
    composition: '主体完整，四周留出标题位置',
    aspectRatio: nearestAspect(element.bounds.w, element.bounds.h),
    reuseGroup: `page-${page.id}`,
    maskElementIds: [],
  }))
  return {
    schema: 'dsh.template-images/v1',
    layoutId: page.layout || 'free',
    pageRole: page.name || page.id,
    style,
    contentPolicy: 'provided-facts-or-qualitative',
    slots,
  }
}
