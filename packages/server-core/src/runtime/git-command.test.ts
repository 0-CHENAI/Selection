import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitEnv, gitExecutable } from './git-command.ts'

describe('gitExecutable', () => {
  it('uses CRAFT_GIT when the file exists', () => {
    const previous = process.env.CRAFT_GIT
    process.env.CRAFT_GIT = process.execPath
    try {
      expect(gitExecutable()).toBe(process.execPath)
    } finally {
      if (previous === undefined) delete process.env.CRAFT_GIT
      else process.env.CRAFT_GIT = previous
    }
  })

  it('accepts CRAFT_GIT paths that contain spaces', () => {
    const previous = process.env.CRAFT_GIT
    const dir = mkdtempSync(join(tmpdir(), 'git space '))
    const fake = join(dir, 'git binary')
    writeFileSync(fake, '')
    process.env.CRAFT_GIT = fake
    try {
      expect(gitExecutable()).toBe(fake)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.CRAFT_GIT
      else process.env.CRAFT_GIT = previous
    }
  })

  it('ignores a missing CRAFT_GIT path', () => {
    const previous = process.env.CRAFT_GIT
    process.env.CRAFT_GIT = '/definitely/not/a/git-binary'
    try {
      expect(gitExecutable()).toBe(process.platform === 'win32' ? 'git.exe' : 'git')
    } finally {
      if (previous === undefined) delete process.env.CRAFT_GIT
      else process.env.CRAFT_GIT = previous
    }
  })
})

describe('gitEnv', () => {
  it('forces LC_ALL=C and suppresses the macOS CLT popup', () => {
    const env = gitEnv({ FOO: 'bar' })
    expect(env.LC_ALL).toBe('C')
    expect(env.APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP).toBe('1')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.FOO).toBe('bar')
  })
})
