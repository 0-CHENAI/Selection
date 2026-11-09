import { describe, expect, it } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expandPath, toPortablePath } from '../paths'

describe('portable home paths', () => {
  it('is idempotent when persistence and JSONL both convert a home path', () => {
    const absolute = join(homedir(), '.selection', 'workspaces', '中文工作区')
    const portable = toPortablePath(absolute)
    expect(portable).toBe('~/.selection/workspaces/中文工作区')
    expect(toPortablePath(portable)).toBe(portable)
    expect(expandPath(toPortablePath(portable))).toBe(absolute)
  })

  it('expands legacy Windows home paths instead of treating tilde as a relative directory', () => {
    expect(expandPath('~\\.selection')).toBe(join(homedir(), '.selection'))
    expect(expandPath('~\\.selection\\workspaces')).toBe(join(homedir(), '.selection', 'workspaces'))
    expect(toPortablePath('~\\.selection\\workspaces')).toBe('~/.selection/workspaces')
  })
})
