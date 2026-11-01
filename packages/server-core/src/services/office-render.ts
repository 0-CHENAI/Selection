/**
 * 阶段 05 使用的渲染入口。顺序来自阶段 02 已合并的 native-plan：
 * 原生优先，没有原生再回退。这里不调用 Word / Excel，也不打开 PoC 门闩。
 * Electron 的 printToPDF / capturePage 由宿主以后接上。
 */

import {
  planNativeOfficeRender,
  type NativeCapabilities,
  type NativePlan,
  type NativeStep,
} from './office-render-poc/native-plan'

export type { NativeCapabilities, NativePlan, NativeStep }

export interface OfficeRenderRequest {
  sourcePath: string
  /** 1-based page, or a sheet range. The chosen step decides how to read it. */
  target?: string
}

export interface OfficeRenderResult {
  kind: 'pdf' | 'png' | 'recalc'
  step: string
  bytes?: Uint8Array
  mediaType?: string
}

export interface OfficeRenderUnavailable {
  unavailable: true
  step: string
  reason: string
}

export interface OfficeRenderHosts {
  preview?(request: OfficeRenderRequest, step: NativeStep): Promise<OfficeRenderResult>
  exportPdf?(request: OfficeRenderRequest, step: NativeStep): Promise<OfficeRenderResult>
  recalc?(request: OfficeRenderRequest, step: NativeStep): Promise<OfficeRenderResult>
}

const DEFAULT_CAPABILITIES: NativeCapabilities = {
  platform: 'linux',
  electronPrintToPdf: true,
  electronCapturePage: true,
  officecliHtml: true,
  officecliFormula: true,
  exporterPdfPlugin: false,
  word: false,
  powerpoint: false,
  excel: false,
}

let capabilities: NativeCapabilities = { ...DEFAULT_CAPABILITIES }
let hosts: OfficeRenderHosts = {}

export function resolveOfficeRenderPlan(caps: NativeCapabilities = capabilities): NativePlan {
  return planNativeOfficeRender(caps)
}

export function setOfficeRenderCapabilities(next: NativeCapabilities | null): void {
  capabilities = next ? { ...next } : { ...DEFAULT_CAPABILITIES }
}

export function getOfficeRenderCapabilities(): NativeCapabilities {
  return { ...capabilities }
}

export function setOfficeRenderHosts(next: OfficeRenderHosts | null): void {
  hosts = next ?? {}
}

function pending(kind: string, step: NativeStep): OfficeRenderUnavailable {
  return {
    unavailable: true,
    step: step.id,
    reason: `${kind} 按已定顺序使用 ${step.id}。当前进程还没有接上这一步的宿主。`,
  }
}

async function run(
  kind: 'pdf' | 'preview' | 'formula',
  request: OfficeRenderRequest,
  host: OfficeRenderHosts['preview'],
): Promise<OfficeRenderResult | OfficeRenderUnavailable> {
  const plan = resolveOfficeRenderPlan()
  const step = plan[kind][0]
  if (!step) return { unavailable: true, step: 'none', reason: `${kind} 没有可用步骤。` }
  if (!host) return pending(kind, step)
  const result = await host(request, step)
  return { ...result, step: step.id }
}

export function officeRenderPreview(request: OfficeRenderRequest): Promise<OfficeRenderResult | OfficeRenderUnavailable> {
  return run('preview', request, hosts.preview)
}

export function officeRenderPdf(request: OfficeRenderRequest): Promise<OfficeRenderResult | OfficeRenderUnavailable> {
  return run('pdf', request, hosts.exportPdf)
}

export function officeRenderRecalc(request: OfficeRenderRequest): Promise<OfficeRenderResult | OfficeRenderUnavailable> {
  return run('formula', request, hosts.recalc)
}
