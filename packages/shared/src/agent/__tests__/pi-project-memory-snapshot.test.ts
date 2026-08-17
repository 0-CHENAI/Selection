import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/craft-agent-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/craft-agent-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      projectId: 'project-test',
      sharedProjectMemoryEnabled: true,
    } as any,
    isHeadless: true,
  }
}

describe('PiAgent project memory snapshot', () => {
  it('resolves project context only once per agent instance', () => {
    const agent = new PiAgent(createConfig())
    let resolutions = 0
    ;(agent as any).resolveProjectContext = () => ({
      name: 'Project',
      assetsPath: '/tmp/project/assets',
      assets: [],
      memoryPath: '/tmp/project/MEMORY.md',
      memoryContent: `snapshot-${++resolutions}`,
    })

    const first = (agent as any).getPinnedProjectContext()
    const second = (agent as any).getPinnedProjectContext()

    expect(resolutions).toBe(1)
    expect(first).toBe(second)
    expect(second.memoryContent).toBe('snapshot-1')
    agent.destroy()
  })

  it('also pins an absent project context instead of re-resolving each turn', () => {
    const agent = new PiAgent(createConfig())
    let resolutions = 0
    ;(agent as any).resolveProjectContext = () => {
      resolutions += 1
      return null
    }

    expect((agent as any).getPinnedProjectContext()).toBeNull()
    expect((agent as any).getPinnedProjectContext()).toBeNull()
    expect(resolutions).toBe(1)
    agent.destroy()
  })
})
