import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { OFFICE_RENDER_LIMITS, OFFICE_RENDER_POC_ENV, OfficeRenderPocError } from './gate.ts'
import { excelDateSerial, readXlsxCells, recalculateWorkbook, type CellInput, type CheckSpec } from './formula.ts'
import { htmlToPdf, pageIsBlank, preparePrintHtml } from './print.ts'
import { planNativeOfficeRender, type NativeCapabilities } from './native-plan.ts'
import { createOfficeRenderPoc, detectOfficeRenderers, exportPdf, recalculate, renderPreview, type PrintHost } from './service.ts'

const enabled = { [OFFICE_RENDER_POC_ENV]: '1' }
const root = join(import.meta.dir, '../../../../..')

function guard(over: Record<string, unknown> = {}) {
  return { bytes: 128, sourceVersion: 'v1', currentVersion: 'v1', env: enabled, ...over }
}

const sampleHtml = `<!DOCTYPE html><html><head>
<style>@font-face{font-family:'Calibri';src:local('Calibri');}</style>
<script>var q='https://fonts.googleapis.com/css2?family=Calibri'</script>
</head><body>
<div class="page" data-page="1" style="width:595.3pt;min-height:841.9pt;padding:72pt 90pt 72pt 90pt;">
<p>阶段02探测：会议纪要。</p>
<p>Second paragraph for pagination evidence.</p>
</div></body></html>`

test('PoC 默认关闭，且没有接到现有入口', () => {
  expect(() => recalculate({ ...guard(), env: {}, cells: [] })).toThrow(OfficeRenderPocError)
  try { recalculate({ ...guard(), env: {}, cells: [] }) }
  catch (error) { expect((error as OfficeRenderPocError).code).toBe('disabled') }
  expect(readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')).not.toContain('office-render-poc')
  expect(readFileSync(join(root, 'apps/electron/resources/skills/ppt-design/engine/screenshot.ts'), 'utf8')).toContain('libreoffice')
  expect(readFileSync(join(root, 'packages/shared/src/prompts/system.ts'), 'utf8')).toContain('PDF export is not included')
})

test('拒绝超限、源文件变化和取消', async () => {
  await expect(exportPdf({ ...guard({ bytes: OFFICE_RENDER_LIMITS.maxInputBytes + 1 }), html: sampleHtml })).rejects.toMatchObject({ code: 'too-large' })
  await expect(exportPdf({ ...guard({ currentVersion: 'v2' }), html: sampleHtml })).rejects.toMatchObject({ code: 'source-changed' })
  const signal = AbortSignal.abort()
  await expect(exportPdf({ ...guard({ signal }), html: sampleHtml })).rejects.toMatchObject({ code: 'cancelled' })
  const pending = new Promise<Uint8Array>(() => {})
  const host: PrintHost = { renderer: 'hang', printToPdf: () => pending }
  await expect(exportPdf({ ...guard({ timeoutMs: 30, host }), html: sampleHtml })).rejects.toMatchObject({ code: 'timeout' })
})

test('A1 打印合同保留中文、页面尺寸和字体声明，并去掉外网字体', async () => {
  const prepared = preparePrintHtml(sampleHtml)
  expect(prepared.html).toContain('会议纪要')
  expect(prepared.html).toContain('@page{size:595.3pt 841.9pt;margin:0}')
  expect(prepared.html).not.toContain('fonts.googleapis.com')
  expect(prepared.networkFontRequestsRemoved).toBe(true)
  expect(prepared.requestedFonts).toContain('Calibri')
  expect(prepared.embeddedFonts).toEqual([])
  expect(prepared.options.preferCSSPageSize).toBe(true)
  expect(prepared.options.pageSize.widthMicrons).toBe(Math.round(595.3 * 25400 / 72))
  expect(prepared.options.pageSize.heightMicrons).toBe(Math.round(841.9 * 25400 / 72))
  const seen: PrintToPdfOptionsCapture[] = []
  const host: PrintHost = {
    renderer: 'electron-printToPDF',
    printToPdf(html, options) {
      seen.push({ html, width: options.pageSize.widthMicrons })
      return Promise.resolve(htmlToPdf(html))
    },
  }
  const exported = await exportPdf({ ...guard({ host }), html: sampleHtml })
  expect(seen[0]?.html).toContain('会议纪要')
  expect(seen[0]?.width).toBe(prepared.options.pageSize.widthMicrons)
  expect(exported.renderer).toBe('electron-printToPDF')
  expect(exported.pageCount).toBeGreaterThan(0)
  expect(exported.texts.join('\n')).toContain('Second paragraph')
})

type PrintToPdfOptionsCapture = { html: string; width: number }

test('空白页立即失败，有内容的像素和区域裁剪可用', async () => {
  await expect(renderPreview({ ...guard(), pixels: new Uint8Array(40).fill(255) })).rejects.toMatchObject({ code: 'blank-page' })
  const pixels = new Uint8Array(40).fill(255)
  pixels[0] = 0
  pixels[10] = 0
  const preview = await renderPreview({
    ...guard(),
    pixels,
    anchors: [
      { address: 'A1', x: 0, y: 0, width: 10, height: 10 },
      { address: 'B1', x: 10, y: 0, width: 10, height: 12 },
      { address: 'A2', x: 0, y: 10, width: 8, height: 8 },
    ],
    range: 'Sheet1!A1:B1',
  })
  expect(preview.blank).toBe(false)
  expect(preview.crop).toEqual({ x: 0, y: 0, width: 20, height: 12 })
  expect(pageIsBlank(new Uint8Array(8).fill(250), 1, 12)).toBe(true)
})

test('并发上限为 2', async () => {
  const poc = createOfficeRenderPoc()
  let started = 0
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const host: PrintHost = {
    renderer: 'selection-html-paginator',
    async printToPdf(html) {
      started++
      await gate
      return htmlToPdf(html)
    },
  }
  const first = poc.exportPdf({ ...guard({ host }), html: sampleHtml })
  const second = poc.exportPdf({ ...guard({ host }), html: sampleHtml })
  await Promise.resolve()
  const third = poc.exportPdf({ ...guard({ host }), html: sampleHtml })
  await Promise.resolve()
  expect(started).toBe(2)
  release!()
  const results = await Promise.all([first, second, third])
  expect(results).toHaveLength(3)
  expect(started).toBe(3)
})

test('DATE 与案例同形的 SUMIFS / AVERAGE / STDEV 可独立重算', () => {
  expect(excelDateSerial(2025, 1, 1)).toBe(45658)
  expect(recalculateWorkbook([{ sheet: 'S', address: 'A1', formula: 'DATE(2025,13,1)' }]).values['S!A1']).toBe(excelDateSerial(2026, 1, 1))
  const cells: CellInput[] = [
    { sheet: '作业明细', address: 'B8', value: excelDateSerial(2025, 1, 1) },
    { sheet: '作业明细', address: 'C8', value: '进港' },
    { sheet: '作业明细', address: 'G8', value: 100 },
    { sheet: '作业明细', address: 'I8', value: 2 },
    { sheet: '作业明细', address: 'B9', value: excelDateSerial(2025, 1, 2) },
    { sheet: '作业明细', address: 'C9', value: '出港' },
    { sheet: '作业明细', address: 'G9', value: 40 },
    { sheet: '作业明细', address: 'I9', value: 4 },
    { sheet: '日度汇总', address: 'D8', formula: 'SUMIFS(\'作业明细\'!$G$8:$G$9,\'作业明细\'!$B$8:$B$9,">="&DATE(2025,1,1),\'作业明细\'!$B$8:$B$9,"<"&DATE(2025,1,2),\'作业明细\'!$C$8:$C$9,"进港")' },
    { sheet: '日度汇总', address: 'B8', formula: "SUM('作业明细'!G8:G9)" },
    { sheet: '日度汇总', address: 'E8', value: 2 },
    { sheet: '剂量响应', address: 'B8', value: 2 },
    { sheet: '剂量响应', address: 'C8', value: 4 },
    { sheet: '剂量响应', address: 'D8', value: 4 },
    { sheet: '剂量响应', address: 'E8', formula: 'AVERAGE(B8:D8)' },
    { sheet: '剂量响应', address: 'F8', formula: 'STDEV(B8:D8)' },
    { sheet: '剂量响应', address: 'G8', value: 5 },
    { sheet: '剂量响应', address: 'G9', value: 1 },
    { sheet: '剂量响应', address: 'G10', value: 4 },
    { sheet: '剂量响应', address: 'H8', formula: 'SUMPRODUCT(--(G9:G10<G8:G9))' },
  ]
  const result = recalculateWorkbook(cells)
  expect(result.values['日度汇总!D8']).toBe(100)
  expect(result.values['日度汇总!B8']).toBe(140)
  expect(result.values['剂量响应!E8']).toBeCloseTo(10 / 3)
  expect(result.values['剂量响应!F8']).toBeCloseTo(Math.sqrt(4 / 3))
  expect(result.values['剂量响应!H8']).toBe(1)
  expect(result.errors).toEqual([])
})

test('改一个源单元格后能发现过期缓存，重算写回港口总览', () => {
  const changed = portOverview(150, 100)
  const result = recalculate({ ...guard(), cells: changed, checks: portChecks(0.015, 190 / 150, 3, 2) })
  expect(result.stale.map(item => item.ref)).toContain('港口总览!B6')
  expect(result.values['港口总览!B6']).toBeCloseTo(0.015)
  expect(result.values['港口总览!F6']).toBeCloseTo(190 / 150)
  expect(result.values['港口总览!J6']).toBe(3)
  expect(result.values['港口总览!N6']).toBe(2)
  expect(result.checks.passed).toBe(true)
  expect(result.changed.find(item => item.ref === '港口总览!B6')?.after).toBeCloseTo(0.015)
  expect(changed.find(cell => cell.address === 'B6')?.cachedValue).toBe(0.01)
})

test('除零、未知函数、循环引用和 OfficeCLI 对拍', () => {
  const result = recalculateWorkbook([
    { sheet: 'Sheet1', address: 'A1', value: 1 },
    { sheet: 'Sheet1', address: 'B1', formula: 'A1/0', officeComputed: 0 },
    { sheet: 'Sheet1', address: 'C1', formula: 'IFERROR(A1/0,7)' },
    { sheet: 'Sheet1', address: 'D1', formula: 'NOTAFUNC(A1)' },
    { sheet: 'Sheet1', address: 'E1', formula: 'F1' },
    { sheet: 'Sheet1', address: 'F1', formula: 'E1' },
    { sheet: 'Sheet1', address: 'G1', formula: 'SUM(A1:A1)', cachedValue: 1, officeComputed: 1 },
  ])
  expect(result.values['Sheet1!B1']).toEqual({ error: '#DIV/0!' })
  expect(result.values['Sheet1!C1']).toBe(7)
  expect(result.values['Sheet1!D1']).toEqual({ error: '#NAME?' })
  expect(result.values['Sheet1!E1']).toEqual({ error: '#CYCLE!' })
  expect(result.values['Sheet1!F1']).toEqual({ error: '#CYCLE!' })
  expect(result.divergences.map(item => item.ref)).toContain('Sheet1!B1')
  expect(result.divergences.map(item => item.ref)).not.toContain('Sheet1!G1')
  expect(result.stale.map(item => item.ref)).not.toContain('Sheet1!G1')
})

const bare: NativeCapabilities = {
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

test('没有 Office、没有 PDF 插件时走 Electron 原生，再回退到替身', () => {
  const plan = planNativeOfficeRender(bare)
  expect(plan.pdf.map(step => step.id)).toEqual(['officecli-html-electron-printToPDF', 'selection-html-paginator'])
  expect(plan.pdf.every(step => !step.requiresOffice)).toBe(true)
  expect(plan.preview[0]?.id).toBe('officecli-html-electron-capturePage')
  expect(plan.formula.map(step => step.id)).toEqual(['officecli-computed-writeback', 'selection-formula-fallback'])
})

test('Windows 上装了 Word 时 PDF 和预览先走 Office 原生', () => {
  const plan = planNativeOfficeRender({ ...bare, platform: 'win32', word: true, powerpoint: true, excel: true })
  expect(plan.pdf.map(step => step.id)).toEqual(['word-export-pdf', 'officecli-html-electron-printToPDF', 'selection-html-paginator'])
  expect(plan.pdf[0]?.requiresOffice).toBe(true)
  expect(plan.pdf[0]?.ciWithoutOffice).toBe(false)
  expect(plan.preview[0]?.id).toBe('officecli-screenshot-native')
  expect(plan.formula[0]?.id).toBe('officecli-computed-writeback')
  expect(plan.formula.map(step => step.id)).toContain('excel-calculate-full')
})

test('已安装的 OfficeCLI PDF 插件排在 Word 和 Electron 之前', () => {
  const plan = planNativeOfficeRender({ ...bare, platform: 'darwin', exporterPdfPlugin: true, word: true })
  expect(plan.pdf.map(step => step.id)[0]).toBe('officecli-view-pdf-plugin')
  expect(plan.preview.some(step => step.id === 'officecli-screenshot-native')).toBe(false)
})

test('系统 Office / LibreOffice 只按命令名探测，探测结果不改变默认渲染器', async () => {
  await expect(detectOfficeRenderers(async () => false)).resolves.toEqual({ word: false, powerpoint: false, excel: false, libreoffice: false })
  await expect(detectOfficeRenderers(async name => name === 'soffice')).resolves.toMatchObject({ libreoffice: true, word: false })
  const exported = await exportPdf({ ...guard(), html: sampleHtml })
  expect(exported.renderer).toBe('selection-html-paginator')
})

test('能从 xlsx 包读出公式并按缓存对拍', () => {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="A2"><v>20</v></c><c r="A3"><f>SUM(A1:A2)</f><v>0</v></c><c r="B1" t="inlineStr"><is><t>进港</t></is></c></row></sheetData></worksheet>`
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
  const bytes = zipSync({
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  })
  const cells = readXlsxCells(bytes)
  expect(cells.find(cell => cell.address === 'B1')?.value).toBe('进港')
  const result = recalculateWorkbook(cells, [{ sheet: 'Sheet1', cell: 'A3', expected: 30 }])
  expect(result.values['Sheet1!A3']).toBe(30)
  expect(result.stale.map(item => item.ref)).toContain('Sheet1!A3')
  expect(result.checks.passed).toBe(true)
})

test('证据文件记录的实现体积与当前源码一致', () => {
  const evidence = JSON.parse(readFileSync(join(root, 'docs/adr/office-render-recalc-evidence.json'), 'utf8')) as { pocImplementationBytes: number; bundlesLibreOffice: boolean; recommendation: { pdf: string; preview: string; formula: string } }
  const bytes = ['formula.ts', 'gate.ts', 'print.ts', 'service.ts', 'native-plan.ts'].reduce((total, file) => total + readFileSync(join(import.meta.dir, file)).byteLength, 0)
  expect(evidence.pocImplementationBytes).toBe(bytes)
  expect(evidence.bundlesLibreOffice).toBe(false)
  expect(evidence.recommendation.pdf).toBe('A1')
  expect(evidence.recommendation.preview).toBe('B2')
  expect(evidence.recommendation.formula).toBe('C1+C3')
})

const portXlsx = process.env.DSH_PORT_CARGO_XLSX
const portChecksPath = process.env.DSH_PORT_CARGO_CHECKS
const bioXlsx = process.env.DSH_BIO_ASSAY_XLSX
const bioChecksPath = process.env.DSH_BIO_ASSAY_CHECKS

test.skipIf(!portXlsx || !portChecksPath)('port-cargo checks.json 在容差内', () => {
  const cells = readXlsxCells(readFileSync(portXlsx!))
  const checks = JSON.parse(readFileSync(portChecksPath!, 'utf8')) as CheckSpec[]
  const result = recalculateWorkbook(cells, checks)
  expect(result.checks.failures).toEqual([])
}, { timeout: 30_000 })

test.skipIf(!bioXlsx || !bioChecksPath)('bio-assay checks.json 在容差内', () => {
  const cells = readXlsxCells(readFileSync(bioXlsx!))
  const checks = JSON.parse(readFileSync(bioChecksPath!, 'utf8')) as CheckSpec[]
  const result = recalculateWorkbook(cells, checks)
  expect(result.checks.failures).toEqual([])
}, { timeout: 30_000 })

function portOverview(tons: number, cachedTons = tons): CellInput[] {
  return [
    { sheet: '作业明细', address: 'C8', value: '进港' },
    { sheet: '作业明细', address: 'G8', value: tons },
    { sheet: '作业明细', address: 'I8', value: 2 },
    { sheet: '作业明细', address: 'I9', value: 4 },
    { sheet: '日度汇总', address: 'D8', formula: 'SUMIFS(\'作业明细\'!G8:G8,\'作业明细\'!C8:C8,"进港")', cachedValue: cachedTons },
    { sheet: '日度汇总', address: 'B8', formula: "SUM('作业明细'!G8:G8)+40", cachedValue: cachedTons + 40 },
    { sheet: '日度汇总', address: 'E8', value: 2 },
    { sheet: '港口总览', address: 'B6', formula: "SUM('日度汇总'!D8:D8)/10000", cachedValue: cachedTons / 10000 },
    { sheet: '港口总览', address: 'F6', formula: "SUM('日度汇总'!B8:B8)/SUM('日度汇总'!D8:D8)", cachedValue: (cachedTons + 40) / cachedTons },
    { sheet: '港口总览', address: 'J6', formula: "AVERAGE('作业明细'!I8:I9)", cachedValue: 3 },
    { sheet: '港口总览', address: 'N6', formula: "SUM('日度汇总'!E8:E8)", cachedValue: 2 },
  ]
}

function portChecks(b6: number, f6: number, j6: number, n6: number): CheckSpec[] {
  return [
    { sheet: '港口总览', cell: 'B6', expected: b6 },
    { sheet: '港口总览', cell: 'F6', expected: f6 },
    { sheet: '港口总览', cell: 'J6', expected: j6 },
    { sheet: '港口总览', cell: 'N6', expected: n6 },
  ]
}
