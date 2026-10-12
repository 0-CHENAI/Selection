import { expect, test } from 'bun:test'
import { assertOfficeRevisionTool } from './office-tool-policy'

test('interactive Office revisions block browser rendering before tool execution', () => {
  for (const command of [
    'officecli view "$FILE" screenshot --grid auto -o before.png',
    'officecli \\\n view report.docx screenshot',
    '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless',
    'npx playwright screenshot http://localhost:1234',
    'open -a "Google Chrome" page.html',
    'xdg-open https://example.com',
  ]) expect(() => assertOfficeRevisionTool('Bash', { command })).toThrow()
  expect(() => assertOfficeRevisionTool('browser_navigate', { url: 'http://localhost' })).toThrow()
  for (const command of ['officecli get "$FILE" /body/p[1] --json', 'officecli view "$FILE" text', 'officecli validate "$FILE"', 'officecli close "$FILE"']) {
    expect(() => assertOfficeRevisionTool('Bash', { command })).not.toThrow()
  }
})
