/** 阶段 02 PoC 门闩。默认关闭，未接入 agent 工具、截图回退或系统提示。 */

export const OFFICE_RENDER_POC_ENV = 'SELECTION_OFFICE_RENDER_POC'

/** dsh office-to-pdf 的输入上限、超时与并发，沿用为 Selection 路径的合同。 */
export const OFFICE_RENDER_LIMITS = {
  maxInputBytes: 50 * 1024 * 1024,
  timeoutMs: 60_000,
  concurrency: 2,
  checkTolerance: 1e-6,
} as const

export type OfficeRenderPocCode = 'disabled' | 'too-large' | 'source-changed' | 'cancelled' | 'timeout' | 'blank-page'

export class OfficeRenderPocError extends Error {
  readonly code: OfficeRenderPocCode
  constructor(code: OfficeRenderPocCode, message: string) {
    super(message)
    this.name = 'OfficeRenderPocError'
    this.code = code
  }
}

export type PocEnv = Record<string, string | undefined>

export function officeRenderPocEnabled(env: PocEnv = process.env): boolean {
  return env[OFFICE_RENDER_POC_ENV] === '1'
}

export function assertOfficeRenderPoc(env: PocEnv = process.env): void {
  if (!officeRenderPocEnabled(env)) {
    throw new OfficeRenderPocError(
      'disabled',
      '渲染、PDF 与公式重算 PoC 默认关闭。只有 SELECTION_OFFICE_RENDER_POC=1 时才能调用，LinNai 拍板前不改变用户可见路径。',
    )
  }
}

export type SourceGuard = {
  bytes: number
  sourceVersion: string
  currentVersion: string
  signal?: AbortSignal
  maxBytes?: number
}

export function assertSourceGuard(guard: SourceGuard): void {
  if (guard.signal?.aborted) throw new OfficeRenderPocError('cancelled', '转换已取消')
  const maxBytes = guard.maxBytes ?? OFFICE_RENDER_LIMITS.maxInputBytes
  if (!Number.isFinite(guard.bytes) || guard.bytes < 0 || guard.bytes > maxBytes) {
    throw new OfficeRenderPocError('too-large', `输入超过 ${maxBytes} 字节`)
  }
  if (guard.sourceVersion !== guard.currentVersion) {
    throw new OfficeRenderPocError('source-changed', '转换期间源文件已变化')
  }
}
