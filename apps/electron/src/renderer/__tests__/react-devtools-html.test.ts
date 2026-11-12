import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripReactDevtoolsHtml } from '../../../vite-strip-react-devtools'

const renderer = join(import.meta.dir, '..')

describe('react-devtools html', () => {
  it('only injects the standalone hook during Vite dev', () => {
    for (const file of ['index.html', 'playground.html']) {
      const html = readFileSync(join(renderer, file), 'utf8')
      expect(html).toContain('import.meta.env.DEV')
      expect(html).toContain('http://localhost:8097')
      expect(html).not.toContain("location.protocol === 'file:'")
    }
  })

  it('strips the hook and CSP origin from packaged html', () => {
    const source = readFileSync(join(renderer, 'index.html'), 'utf8')
    const packed = stripReactDevtoolsHtml(source)
    expect(packed).not.toContain('localhost:8097')
    expect(packed).not.toContain('import.meta.env.DEV')
    expect(packed).toContain('id="root"')
    expect(stripReactDevtoolsHtml(readFileSync(join(renderer, 'playground.html'), 'utf8'))).not.toContain('8097')
  })
})
