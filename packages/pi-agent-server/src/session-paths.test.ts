import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { resolvePiSessionPaths } from './session-paths.ts'

describe('Pi SDK session path isolation', () => {
  it('uses distinct SDK and extension directories for sibling Craft Sessions', () => {
    const pathsA = resolvePiSessionPaths('/workspace/sessions/session-a')
    const pathsB = resolvePiSessionPaths('/workspace/sessions/session-b')

    expect(pathsA).toEqual({
      agentDir: join('/workspace/sessions/session-a', '.pi-agent'),
      sessionDir: join('/workspace/sessions/session-a', '.pi-sessions'),
    })
    expect(pathsB).toEqual({
      agentDir: join('/workspace/sessions/session-b', '.pi-agent'),
      sessionDir: join('/workspace/sessions/session-b', '.pi-sessions'),
    })
    expect(pathsA.agentDir).not.toBe(pathsB.agentDir)
    expect(pathsA.sessionDir).not.toBe(pathsB.sessionDir)
  })

  it('keeps an explicit agent directory but never shares the SDK session directory', () => {
    expect(resolvePiSessionPaths('/workspace/sessions/session-b', '/custom/agent-dir')).toEqual({
      agentDir: '/custom/agent-dir',
      sessionDir: join('/workspace/sessions/session-b', '.pi-sessions'),
    })
  })
})
