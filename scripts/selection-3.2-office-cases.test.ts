import { createHash } from 'node:crypto'
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { runOfficeCases } from './selection-3.2-office-cases'

const xml = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false, ignoreDeclaration: true })
const stableDocument = (bytes: Uint8Array) => strFromU8(bytes).replace(/ w14:textId="[^"]*"/g, '')

test.skipIf(process.env.OFFICECLI_INTEGRATION !== '1')('two Word cases and an Excel case preserve template structure through targeted edits', async () => {
  const output = mkdtempSync(join(tmpdir(), 'office-cases-'))
  try {
    const cases = await runOfficeCases(output)
    for (const item of cases) {
      expect(createHash('sha256').update(readFileSync(item.template)).digest('hex')).toBe(item.templateHash)
      expect(JSON.parse(item.validation).data.errors).toEqual([])
      expect(JSON.parse(item.issues).data.issues).toEqual([])
      const original = unzipSync(readFileSync(item.template)), edited = unzipSync(readFileSync(item.edited))
      expect(Object.keys(edited).sort()).toEqual(Object.keys(original).sort())
      if (item.definition.format === 'docx') {
        expect(item.text).toContain(item.definition.expectedText)
        expect(item.text).toContain(item.definition.unchangedText)
        for (const part of ['word/styles.xml', 'word/header1.xml', 'word/footer1.xml']) expect(xml.parse(strFromU8(edited[part]!))).toEqual(xml.parse(strFromU8(original[part]!)))
        // XML tree equivalence preserves content/order/format while allowing namespace attribute reordering and text-version IDs to change.
        expect(xml.parse(stableDocument(edited['word/document.xml']!).replace(item.definition.edit.replace, item.definition.edit.find))).toEqual(xml.parse(stableDocument(original['word/document.xml']!)))
      } else {
        expect(edited['xl/styles.xml']).toEqual(original['xl/styles.xml'])
        const sheetBefore = strFromU8(original['xl/worksheets/sheet1.xml']!), sheetAfter = strFromU8(edited['xl/worksheets/sheet1.xml']!)
        const unchanged = (pattern: RegExp) => {
          const before = sheetBefore.match(pattern)
          expect(before).not.toBeNull()
          expect(sheetAfter.match(pattern)?.[0]).toBe(before![0])
        }
        for (const range of ['cols', 'dataValidations', 'sheetViews']) unchanged(new RegExp(`<x:${range}[\\s\\S]*?</x:${range}>`))
        for (const cell of ['A2', 'B2', 'A3', 'B3', 'C3', 'D3', 'E3']) unchanged(new RegExp(`<x:c r="${cell}"[\\s\\S]*?</x:c>`))
        for (const [path, expected] of Object.entries(item.definition.expectedValues)) {
          const result = item.cells[path] as { data: { results: Array<{ format: Record<string, unknown> }> } }
          const format = result.data.results[0]!.format
          expect(format.formula).toBe(item.definition.formulas[path])
          expect(Number(format.cachedValue)).toBeCloseTo(Number(expected), 10)
        }
      }
    }
  } finally { rmSync(output, { recursive: true, force: true }) }
}, 120_000)
