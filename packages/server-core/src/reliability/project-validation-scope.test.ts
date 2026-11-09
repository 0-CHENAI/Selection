import { expect, test } from 'bun:test'
import { requiresProjectValidation } from './project-validation-scope'

test('code, dependencies, build and validation configuration require project checks', () => {
  for (const path of ['packages/app/package.json', 'C:\\project\\pnpm-lock.yaml', 'tsconfig.build.json', 'src/view.vue', 'style.scss', '.github/workflows/ci.yml', '.eslintrc.json', 'Dockerfile', 'pyproject.toml', 'build.ps1']) {
    expect(requiresProjectValidation(path)).toBe(true)
  }
})

test('ordinary standalone reports retain format validation', () => {
  for (const path of ['report.txt', 'data.json', 'report.html', 'deck.pptx', 'notes.md', 'package.json.txt']) expect(requiresProjectValidation(path)).toBe(false)
})
