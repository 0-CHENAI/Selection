import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionToolContext } from '../context.ts'
import { handleXlsxRecalculate, XlsxRecalculateSchema, OfficeTemplateWriteSchema } from './office-template.ts'

test('the concise Excel guide sends a schema-valid recalc request with key cells and no visual review', async () => {
  const guide = readFileSync(join(import.meta.dir, '../../../../apps/electron/resources/skills/officecli/guides/excel.md'), 'utf8')
  const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]!))
  const request = examples.find(value => !Array.isArray(value))
  expect(XlsxRecalculateSchema.safeParse(request).success).toBe(true)
  expect(request.key_cells).toEqual(['Sheet1!B3'])
  expect(request.visual_review).toBe('not-needed')
  const calls: unknown[] = []
  const result = await handleXlsxRecalculate({
    officeTools: async (name: string, args: unknown) => { calls.push({ name, args }); return { ready: true } },
  } as unknown as SessionToolContext, request)
  expect(result.isError).toBe(false)
  expect(calls).toEqual([{ name: 'xlsx_recalculate', args: request }])
  expect(XlsxRecalculateSchema.safeParse({ ...request, expected: 100 }).success).toBe(false)
})


test('Word schema accepts insertion before a paragraph and optional source coverage without requiring after', () => {
  const request = { template_id: 'style-system-design', output_path: 'report.docx', source_text_path: 'source.txt', replacements: [], additions: [{ before_paragraph_id: 'p16', style_from: 'p7', text: '表后正文' }] }
  expect(OfficeTemplateWriteSchema.parse(request)).toEqual(request)
  expect(OfficeTemplateWriteSchema.parse({ output_path: 'old.docx', replacements: [], additions: [{ after_paragraph_id: 'p7', text: '旧调用兼容' }] }).additions?.[0]?.after_paragraph_id).toBe('p7')
})
