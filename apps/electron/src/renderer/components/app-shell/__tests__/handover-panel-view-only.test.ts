import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('HandoverPanel has no mode-switch create entry and keeps source/target links', () => {
  const panel = readFileSync(join(import.meta.dir, '../HandoverPanel.tsx'), 'utf8')
  expect(panel).not.toContain("type: 'create'")
  expect(panel).not.toContain('dontShowAgain')
  expect(panel).not.toContain('startHandover')
  expect(panel).not.toContain('handover.toPro')
  expect(panel).toContain("type: 'list'")
  expect(panel).toContain('handover.openSource')
  expect(panel).toContain('handover.openTarget')
})
