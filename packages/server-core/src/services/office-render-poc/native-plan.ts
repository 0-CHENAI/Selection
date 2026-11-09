/**
 * 原生优先的选择器。只根据能力快照决定顺序，不调用 Word、Quick Look 或打印假脱机。
 * macOS / Windows 的 COM 和 Quick Look 不能在 Linux 上执行，调用方用实测填快照。
 */

export type NativeCapabilities = {
  platform: 'darwin' | 'win32' | 'linux' | string
  /** 进程里有 Electron，可以用 webContents.printToPDF。 */
  electronPrintToPdf: boolean
  /** 进程里有 Electron，可以用 webContents.capturePage。 */
  electronCapturePage: boolean
  /** OfficeCLI view html 可用。 */
  officecliHtml: boolean
  /** OfficeCLI 自带公式求值可用。 */
  officecliFormula: boolean
  /** 已按插件协议装上 PDF exporter，不是随包的。 */
  exporterPdfPlugin: boolean
  word: boolean
  powerpoint: boolean
  excel: boolean
}

export type NativeStep = {
  id: string
  /** 这一步是否必须本机已安装 Office。 */
  requiresOffice: boolean
  /** 当前 CI 能否在不安装 Office 的托管 runner 上执行这一步。 */
  ciWithoutOffice: boolean
}

export type NativePlan = {
  pdf: NativeStep[]
  preview: NativeStep[]
  formula: NativeStep[]
}

export function planNativeOfficeRender(caps: NativeCapabilities): NativePlan {
  return {
    pdf: pdfSteps(caps),
    preview: previewSteps(caps),
    formula: formulaSteps(caps),
  }
}

function pdfSteps(caps: NativeCapabilities): NativeStep[] {
  const steps: NativeStep[] = []
  if (caps.exporterPdfPlugin) {
    steps.push({ id: 'officecli-view-pdf-plugin', requiresOffice: false, ciWithoutOffice: false })
  }
  if (caps.word && (caps.platform === 'win32' || caps.platform === 'darwin')) {
    steps.push({ id: 'word-export-pdf', requiresOffice: true, ciWithoutOffice: false })
  }
  if (caps.officecliHtml && caps.electronPrintToPdf) {
    steps.push({ id: 'officecli-html-electron-printToPDF', requiresOffice: false, ciWithoutOffice: true })
  }
  steps.push({ id: 'selection-html-paginator', requiresOffice: false, ciWithoutOffice: true })
  return steps
}

function previewSteps(caps: NativeCapabilities): NativeStep[] {
  const steps: NativeStep[] = []
  if (caps.platform === 'win32' && (caps.word || caps.powerpoint)) {
    steps.push({ id: 'officecli-screenshot-native', requiresOffice: true, ciWithoutOffice: false })
  }
  if (caps.officecliHtml && caps.electronCapturePage) {
    steps.push({ id: 'officecli-html-electron-capturePage', requiresOffice: false, ciWithoutOffice: true })
  }
  steps.push({ id: 'officecli-screenshot-html-browser', requiresOffice: false, ciWithoutOffice: false })
  return steps
}

function formulaSteps(caps: NativeCapabilities): NativeStep[] {
  const steps: NativeStep[] = []
  if (caps.officecliFormula) {
    steps.push({ id: 'officecli-computed-writeback', requiresOffice: false, ciWithoutOffice: true })
  }
  if (caps.excel && (caps.platform === 'win32' || caps.platform === 'darwin')) {
    steps.push({ id: 'excel-calculate-full', requiresOffice: true, ciWithoutOffice: false })
  }
  steps.push({ id: 'selection-formula-fallback', requiresOffice: false, ciWithoutOffice: true })
  return steps
}
