import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { OFFICE_BUSINESS_RUNTIME } from './index.ts'

const repoRoot = join(import.meta.dir, '../../..')

function filesUnder(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...filesUnder(path))
    else found.push(path)
  }
  return found
}

test('office parity path ships no Python and stays out of the installer', () => {
  expect(OFFICE_BUSINESS_RUNTIME).toEqual({ engine: 'bun', bundledPython: false, userFacing: true, installerBundle: false })

  const roots = [
    join(repoRoot, 'packages/office-business-runtime'),
    join(repoRoot, 'scripts/fixtures/office-parity'),
  ]
  const packaged = filesUnder(roots[0]!).concat(filesUnder(roots[1]!))
  const pythonFiles = packaged.filter(path => /\.(py|pyc)$/.test(path) || path.endsWith('requirements.txt'))
  expect(pythonFiles).toEqual([])

  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'packages/office-business-runtime/package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  expect(packageJson.dependencies ?? {}).toEqual({})
  expect(packageJson.optionalDependencies ?? {}).toEqual({})

  const builder = readFileSync(join(repoRoot, 'apps/electron/electron-builder.yml'), 'utf8')
  expect(builder.includes('office-business-runtime')).toBe(false)

  for (const workflow of filesUnder(join(repoRoot, '.github/workflows'))) {
    const text = readFileSync(workflow, 'utf8')
    expect(text.includes('office-business-runtime')).toBe(false)
  }
})

test('installer inputs carry no LibreOffice Kit, PPTD engine, or Office Python scripts', () => {
  const builder = readFileSync(join(repoRoot, 'apps/electron/electron-builder.yml'), 'utf8').toLowerCase()
  for (const word of ['libreoffice', 'soffice', 'lokit', 'pptd']) expect(builder.includes(word)).toBe(false)

  const shipped = [
    'apps/electron/resources/skills/office-business',
    'apps/electron/resources/skills/ppt-design',
    'apps/electron/resources/bin',
  ].flatMap(dir => filesUnder(join(repoRoot, dir)))
  const forbidden = shipped.filter(path => /\.(py|pyc)$/i.test(path) || /soffice|libreoffice|lokit|pptd/i.test(path.slice(repoRoot.length)))
  expect(forbidden).toEqual([])
})
