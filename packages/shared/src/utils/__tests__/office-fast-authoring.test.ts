import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const resources = resolve(import.meta.dir, '../../../../../apps/electron/resources')
const guides = join(resources, 'skills/officecli/guides')
const binary = join(resources, 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'officecli.exe' : 'officecli')
const nativeTest = existsSync(binary) ? test : test.skip

describe('Selection concise Office authoring', () => {
  test('ordinary chat routes to the same slim guides as Office mode', () => {
    const router = readFileSync(join(resources, 'skills/officecli/SKILL.md'), 'utf8')
    expect(router).toContain('[Word](guides/word.md)')
    expect(router).toContain('[Excel](guides/excel.md)')
    expect(router).not.toContain('| Word | `officecli load_skill word` |')
    expect(router).not.toContain('Continue until the official Delivery Gate passes')
    expect(router).not.toContain('follow every validation and visual check required by the loaded official guide')
    for (const format of ['word', 'excel']) {
      const guide = readFileSync(join(guides, `${format}.md`), 'utf8')
      expect(guide.length).toBeLessThan(6000)
      expect(guide).toContain('不要默认截图')
      expect(guide).toContain('validate')
      expect(guide).toContain('非零退出')
    }
  })

  nativeTest('both launchers load the Selection Word reference instead of embedded legacy QA', () => {
    const expected = readFileSync(join(guides, 'word-reference.md'), 'utf8')
    const commands = [
      [process.execPath, join(resources, 'scripts/officecli-wrapper.ts'), binary, 'load_skill', 'word'],
      ...(process.platform === 'win32' ? [] : [[join(resources, 'bin/officecli'), 'load_skill', 'word']]),
    ]
    for (const command of commands) {
      const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(result.stdout.toString()).toBe(expected)
      expect(result.stdout.toString()).not.toContain('Assume there are problems')
    }
  })

  for (const [format, ext] of [['word', 'docx'], ['excel', 'xlsx']] as const) {
    nativeTest(`${format}: real guide batch creates a valid file and scoped edit preserves unrelated content`, () => {
      const scratch = mkdtempSync(join(tmpdir(), 'selection-fast-office-'))
      const file = join(scratch, `sample.${ext}`)
      const run = (args: string[]) => {
        const result = Bun.spawnSync([binary, ...args], {
          stdout: 'pipe', stderr: 'pipe',
          env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' },
        })
        const output = result.stdout.toString() + result.stderr.toString()
        expect(result.exitCode, output).toBe(0)
        return output
      }
      try {
        const guide = readFileSync(join(guides, `${format}.md`), 'utf8')
        const batch = JSON.parse(guide.match(/```json\n([\s\S]*?)\n```/)![1]!)
        if (format === 'word') batch.push({ command: 'add', parent: '/body/p[2]', type: 'run', props: { text: '待修改', bold: true } })
        const input = join(scratch, 'batch.json')
        writeFileSync(input, JSON.stringify(batch))
        run(['create', file])
        run(['batch', file, '--input', input, '--json'])
        run(['validate', file])
        const get = (path: string) => {
          const results = JSON.parse(run(['get', file, path, '--json'])).data.results
          expect(results, path).toBeArray()
          expect(results, path).toHaveLength(1)
          return results
        }
        const preservedPaths = format === 'word'
          ? ['/body/p[1]', '/body/p[2]/r[1]', '/body/p[3]']
          : ['/Sheet1/B2', '/Sheet1/B3']
        const before = preservedPaths.map(get)
        const target = format === 'word' ? '/body/p[2]/r[2]' : '/Sheet1/A2'
        const props = format === 'word' ? { text: '定点修订' } : { value: '定点修订' }
        writeFileSync(input, JSON.stringify([{ command: 'set', path: target, props }]))
        run(['batch', file, '--input', input, '--json'])
        run(['validate', file])
        expect(run(['get', file, target, '--json'])).toContain('定点修订')
        expect(preservedPaths.map(get)).toEqual(before)
      } finally { rmSync(scratch, { recursive: true, force: true }) }
    }, 30_000)
  }
})
