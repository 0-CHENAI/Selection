/** Reproducible fictional business cases. All document writes go through the reviewed OfficeCLI launcher. */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { getOfficecliWrapperDir, resolveOfficecliBinary } from '../packages/shared/src/utils/officecli'

export const officeCaseRecipes = [
  'cases/selection-samples/meeting-minutes.json',
  'cases/selection-samples/work-notice.json',
  'cases/execution-tracker.json',
] as const
export async function runOfficeCases(output: string) {
  mkdirSync(output, { recursive: true })
  if (readdirSync(output).length) throw new Error('QA directory must be empty')
  const binary = resolveOfficecliBinary()
  const wrappers = getOfficecliWrapperDir()
  if (!binary || !wrappers) throw new Error('Reviewed OfficeCLI runtime missing')
  const launcher = join(dirname(wrappers), 'scripts/officecli-wrapper.ts')
  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, launcher, binary, ...args], { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' }, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (code !== 0 || /WARNING|UNSUPPORTED/.test(stderr)) throw new Error(`${args[0]} failed (${code}): ${stderr || stdout}`)
    return stdout
  }
  const results = []
  for (const recipe of officeCaseRecipes) {
    const definition = JSON.parse(readFileSync(resolve(import.meta.dir, `../apps/electron/resources/skills/office-business/${recipe}`), 'utf8'))
    const id = definition.id as string
    const template = join(output, `${id}-template.${definition.format}`)
    const edited = join(output, `${id}-edited.${definition.format}`)
    const batch = join(output, `${id}-create.json`)
    // No overwrites: the harness owns only fresh output directories.
    await run('create', template)
    writeFileSync(batch, JSON.stringify(definition.create))
    await run('batch', template, '--input', batch, '--json')
    await run('validate', template)
    await run('close', template)
    const templateHash = createHash('sha256').update(readFileSync(template)).digest('hex')
    copyFileSync(template, edited)
    const edit = definition.edit
    if (definition.format === 'docx') {
      await run('set', edited, edit.path, '--find', edit.find, '--replace', edit.replace, '--json')
    } else {
      await run('set', edited, edit.path, '--prop', `value=${edit.value}`)
      for (const [path, formula] of Object.entries(definition.formulas)) await run('set', edited, path, '--prop', `formula=${formula}`)
    }
    await run('close', edited)
    const validation = await run('validate', edited, '--json')
    const text = await run('view', edited, 'text')
    const issues = await run('view', edited, 'issues', '--json')
    const cells: Record<string, unknown> = {}
    if (definition.format === 'xlsx') for (const path of Object.keys(definition.expectedValues)) cells[path] = JSON.parse(await run('get', edited, path, '--json'))
    writeFileSync(join(output, `${id}-readback.json`), JSON.stringify({ validation, issues, text, cells }, null, 2))
    results.push({ id, template, templateHash, edited, definition, validation, issues, text, cells })
  }
  return results
}
if (import.meta.main) {
  const output = process.argv[2]
  if (!output) throw new Error('Usage: bun scripts/selection-3.2-office-cases.ts ABSOLUTE_FRESH_QA_DIR')
  console.log(JSON.stringify(await runOfficeCases(resolve(output)), null, 2))
}
