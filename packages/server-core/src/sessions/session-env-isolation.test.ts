import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('SessionManager subprocess environment isolation', () => {
  const source = readFileSync(join(import.meta.dir, 'SessionManager.ts'), 'utf-8')

  it('passes CRAFT_SESSION_DIR through per-agent overrides', () => {
    expect(source).toContain('CRAFT_SESSION_DIR: sessionPath')
  })

  it('never stores a session directory in the shared process environment', () => {
    expect(source).not.toContain('process.env.CRAFT_SESSION_DIR =')
  })

  it('does not write user message bodies to the session log', () => {
    expect(source).not.toContain("sessionLog.info('Message:', message)")
  })
})
