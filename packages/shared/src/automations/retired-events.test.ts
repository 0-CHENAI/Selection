import { afterEach, beforeEach, describe, expect, test, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutomationSystem } from './automation-system'
import { RETIRED_AUTOMATION_EVENTS } from './legacy-migration'
import { validateAutomationsConfig } from './validation'
import { RetryScheduler } from './retry-scheduler'
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants'

describe('retired runtime automations', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'retired-automations-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  test('ignores all retired payloads before validation while preserving app rules', async () => {
    const config = {
      version: 2,
      automations: {
        ...Object.fromEntries(RETIRED_AUTOMATION_EVENTS.map(event => [event, { malformed: true }])),
        LabelAdd: [{ matcher: '^urgent$', actions: [{ type: 'prompt', prompt: 'Review $CRAFT_LABEL' }] }],
        SchedulerTick: [{ id: 'daily', cron: '0 9 * * *', actions: [{ type: 'prompt', prompt: 'Daily review' }] }],
      },
    }
    writeFileSync(join(root, 'automations.json'), JSON.stringify(config))
    const prompts: string[] = []
    const warn = spyOn(console, 'warn')
    const system = new AutomationSystem({ workspaceRootPath: root, workspaceId: 'test', onPromptsReady: pending => { prompts.push(...pending.map(p => p.prompt)) } })
    try {
      expect(Object.keys(system.getConfig()!.automations)).toEqual(['LabelAdd', 'SchedulerTick'])
      expect(system.getMatchersForEvent('LabelAdd')[0]?.id).toMatch(/^[0-9a-f]{6}$/)
      expect(system.reloadConfig().success).toBe(true)
      expect(warn).not.toHaveBeenCalled()
      expect(Object.keys(JSON.parse(readFileSync(join(root, 'automations.json'), 'utf8')).automations)).toEqual(['LabelAdd', 'SchedulerTick'])
      await system.emit('LabelAdd', { workspaceId: 'test', timestamp: Date.now(), label: 'urgent' })
      expect(prompts).toEqual(['Review urgent'])
      expect(system.matchEvent('LabelAdd', { label: 'other' })).toEqual([])
      expect(system.getMatchersForEvent('SchedulerTick')).toHaveLength(1)
    } finally { warn.mockRestore(); await system.dispose() }
  })

  test('rejects tool decision actions on surviving events and strips retired prompt flags', () => {
    expect(validateAutomationsConfig({ automations: { LabelAdd: [{ actions: [{ type: 'decision', decision: 'block' }] }] } }).valid).toBe(false)
    const result = validateAutomationsConfig({ automations: { LabelAdd: [{ maxDepth: 3, actions: [{ type: 'prompt', prompt: 'Review', reportBack: true, waitForCompletion: true, timeoutMs: 100 }] }] } })
    expect(result.config?.automations.LabelAdd).toEqual([{ actions: [{ type: 'prompt', prompt: 'Review' }] }])
  })

  test('drops persisted retries for inactive rules before any HTTP request', async () => {
    const file = join(root, AUTOMATIONS_RETRY_QUEUE_FILE)
    const entry = (id: string, due: number) => ({ id, matcherId: id, action: { type: 'webhook', url: 'https://example.com/retired' }, expandedUrl: 'https://example.com/retired', nextRetryAt: due, createdAt: 1, deferredAttempt: 0 })
    writeFileSync(file, [entry('retired', 0), entry('active', Date.now() + 60_000)].map(e => JSON.stringify(e)).join('\n'))
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected request'))
    const scheduler = new RetryScheduler({ workspaceRootPath: root, isMatcherActive: id => id === 'active' })
    try {
      await (scheduler as unknown as { tick(): Promise<void> }).tick()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(readFileSync(file, 'utf8')).not.toContain('"retired"')
      expect(readFileSync(file, 'utf8')).toContain('"active"')
    } finally { fetchSpy.mockRestore(); scheduler.dispose() }
  })
})
