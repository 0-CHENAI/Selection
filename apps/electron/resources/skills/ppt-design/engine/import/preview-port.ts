/**
 * 阶段 02（#705）还没有选定渲染路径。导入只依赖这个接口，不在这里决定预览或 PDF 怎么画。
 */
export const RENDER_PATH_UNDECIDED = '阶段 02（#705）尚未选定渲染路径。预览和 PDF 仍通过这个接口接入，导入本身不生成画面。'

export type SlidePreviewRequest = {
  title: string
  pageCount: number
  outDir?: string
}

export type SlidePreviewResult = {
  status: 'ok' | 'unavailable'
  reason?: string
  files?: string[]
}

export type SlidePreviewPort = (request: SlidePreviewRequest) => Promise<SlidePreviewResult>

export async function previewImportedSlides(request: SlidePreviewRequest, port?: SlidePreviewPort): Promise<SlidePreviewResult> {
  if (!port) return { status: 'unavailable', reason: RENDER_PATH_UNDECIDED }
  return port(request)
}
