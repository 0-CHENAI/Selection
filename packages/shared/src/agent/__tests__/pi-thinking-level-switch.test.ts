import { expect, test } from 'bun:test'
import { PiAgent } from '../pi-agent'
import type { ThinkingLevel } from '../thinking-levels'

function fixture(thinkingLevel?: ThinkingLevel) {
  const agent = new PiAgent({ provider: 'pi', isHeadless: true, skipConfigWatcher: true,
    workspace: { id: 'ws', name: 'Workspace', rootPath: '/tmp/effort-switch' },
    session: { id: 'session' }, model: 'wide', thinkingLevel,
    runtime: { customModels: [
      { id: 'wide', thinkingSource: 'explicit', supportedThinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { id: 'narrow', thinkingSource: 'explicit', supportedThinkingLevels: ['low', 'high'] },
      { id: 'plain', thinkingSource: 'explicit', supportedThinkingLevels: [] },
      { id: 'single', thinkingSource: 'explicit', supportedThinkingLevels: ['high'] },
    ] },
  } as never)
  const internal = agent as any
  const sent: Array<{ type: string; level?: string; model?: string }> = []
  internal.subprocess = {}
  internal.send = (message: typeof sent[number]) => sent.push(message)
  return { agent, sent, cleanup() { internal.subprocess = null; agent.destroy() } }
}

test('preserves requested effort through narrower and non-reasoning models and back', () => {
  const f = fixture('xhigh')
  try {
    for (const [model, effective] of [['wide', 'xhigh'], ['narrow', 'high'], ['plain', 'off'], ['single', 'high'], ['wide', 'xhigh']]) {
      f.agent.setModel(model!)
      expect(f.sent.at(-1)).toEqual({ type: 'set_thinking_level', level: effective })
      expect(f.agent.getThinkingLevel()).toBe('xhigh')
    }
  } finally { f.cleanup() }
})

test('retains supported choices, nearest-stop tie semantics, and the default without a user choice', () => {
  const f = fixture()
  try {
    expect(f.agent.getThinkingLevel()).toBe('medium')
    f.agent.setModel('narrow')
    expect(f.sent.at(-1)?.level).toBe('low') // Existing nearest-stop tie rule.
    f.agent.setModel('wide')
    expect(f.sent.at(-1)?.level).toBe('medium')
    f.agent.setThinkingLevel('high')
    f.agent.setModel('narrow')
    expect(f.sent.at(-1)?.level).toBe('high')
    f.agent.setModel('plain')
    f.agent.setThinkingLevel('max')
    expect(f.sent.at(-1)?.level).toBe('off')
    expect(f.agent.getThinkingLevel()).toBe('max')
    f.agent.setModel('wide')
    expect(f.sent.at(-1)?.level).toBe('max')
  } finally { f.cleanup() }
})
