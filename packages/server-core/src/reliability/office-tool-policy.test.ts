import { expect, test } from 'bun:test'
import { assertOfficeRevisionTool, isOfficeRenderTool } from './office-tool-policy'

test('interactive Office revisions block browser rendering before tool execution', () => {
  for (const command of [
    'officecli view "$FILE" screenshot --grid auto -o before.png',
    'officecli \\\n view report.docx screenshot',
    'officecli view report.docx screenshot --render native',
    '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless',
    'npx playwright screenshot http://localhost:1234',
    'open -a "Google Chrome" page.html',
    'xdg-open https://example.com',
  ]) expect(() => assertOfficeRevisionTool('Bash', { command })).toThrow()
  expect(() => assertOfficeRevisionTool('browser_navigate', { url: 'http://localhost' })).toThrow()
  expect(() => assertOfficeRevisionTool('mcp__session__browser_tool', { command: 'screenshot' })).toThrow()
  for (const command of ['officecli get "$FILE" /body/p[1] --json', 'officecli view "$FILE" text', 'officecli validate "$FILE"', 'officecli close "$FILE"']) {
    expect(() => assertOfficeRevisionTool('Bash', { command })).not.toThrow()
  }
})

test('office_render is allowed during Office revisions', () => {
  for (const name of ['office_render', 'mcp__session__office_render', 'session__office_render']) {
    expect(isOfficeRenderTool(name)).toBe(true)
    expect(() => assertOfficeRevisionTool(name, { path: '/tmp/report.docx', pages: '1,last' })).not.toThrow()
  }
  // Lookalike external tools are not the host tool.
  expect(isOfficeRenderTool('mcp__other__office_render')).toBe(false)
  expect(isOfficeRenderTool('office_render_browser')).toBe(false)
  expect(() => assertOfficeRevisionTool('office_render_browser', {})).toThrow()
})

test('OCR stays blocked during Office revisions', () => {
  for (const command of [
    'tesseract page-1.png out',
    'ocrmypdf in.pdf out.pdf',
    'python3 -m pytesseract page.png',
    'python3 -c "import pytesseract; print(pytesseract.image_to_string(\'p.png\'))"',
    'cd /tmp && /usr/local/bin/tesseract p.png -',
    'swift -e "let r = VNRecognizeTextRequest()"',
  ]) expect(() => assertOfficeRevisionTool('Bash', { command })).toThrow(/OCR/)
  expect(() => assertOfficeRevisionTool('Bash', { command: 'officecli view report.docx issues' })).not.toThrow()
})
