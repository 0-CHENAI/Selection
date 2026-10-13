import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackendConfig } from '../backend/types.ts'
import { permissionsConfigCache } from '../permissions-config.ts'
import { PiAgent } from '../pi-agent.ts'

function createConfig(workspaceRootPath: string): BackendConfig {
  return {
    provider: 'pi',
    workspace: { id: 'ws-always-allow', name: 'Always Allow Tests', rootPath: workspaceRootPath } as any,
    session: {
      id: 'session-always-allow',
      workspaceRootPath,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
  }
}

// Regression: PiAgent used to ignore the "Always allow" flag, so the same
// command prompted again every time.
describe('PiAgent "Always allow" in Smart Approval mode', () => {
  let root: string
  let previousConfigDir: string | undefined
  let agent: PiAgent
  let sent: Array<Record<string, unknown>>
  let prompts: number

  const runBash = (requestId: string, command: string) =>
    (agent as any).handlePreToolUseRequest({ requestId, toolCallId: `${requestId}-call`, toolName: 'Bash', input: { command } })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'selection-always-allow-'))
    previousConfigDir = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = join(root, 'config') // keep the user's real permissions out of the test
    permissionsConfigCache.clear()
    agent = new PiAgent(createConfig(root))
    agent.setPermissionMode('ask')
    sent = []
    prompts = 0
    ;(agent as any).send = (message: Record<string, unknown>) => sent.push(message)
  })

  afterEach(() => {
    agent.destroy()
    if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = previousConfigDir
    permissionsConfigCache.clear()
    rmSync(root, { recursive: true, force: true })
  })

  it('remembers the exact command for the rest of the session', async () => {
    agent.onPermissionRequest = request => {
      prompts++
      agent.respondToPermission(request.requestId, true, true)
    }

    await runBash('first', 'rm -rf build')
    expect(prompts).toBe(1)
    expect(sent.at(-1)).toMatchObject({ requestId: 'first', action: 'allow' })

    await runBash('second', 'rm -rf build')
    expect(prompts).toBe(1)
    expect(sent.at(-1)).toMatchObject({ requestId: 'second', action: 'allow' })

    await runBash('different', 'rm -rf src')
    expect(prompts).toBe(2)
  })

  it('plain "Allow" approves only once', async () => {
    agent.onPermissionRequest = request => {
      prompts++
      agent.respondToPermission(request.requestId, true, false)
    }

    await runBash('first', 'rm -rf build')
    await runBash('second', 'rm -rf build')
    expect(prompts).toBe(2)
  })

  it('a denied request is never remembered', async () => {
    agent.onPermissionRequest = request => {
      prompts++
      agent.respondToPermission(request.requestId, false, true)
    }

    await runBash('first', 'rm -rf build')
    expect(sent.at(-1)).toMatchObject({ requestId: 'first', action: 'block' })
    await runBash('second', 'rm -rf build')
    expect(prompts).toBe(2)
  })
})
