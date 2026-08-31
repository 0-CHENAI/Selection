import { describe, expect, it } from 'bun:test'
import { resolveSwarmBadgeState } from '../swarm-badge-state'

describe('Swarm composer badge', () => {
  it('exposes idle, enabled, and running states independently from session status', () => {
    expect(resolveSwarmBadgeState(false, false)).toBe('idle')
    expect(resolveSwarmBadgeState(true, false)).toBe('enabled')
    expect(resolveSwarmBadgeState(true, true)).toBe('running')
  })

  it('prioritizes a live run over a stale disabled-mode flag', () => {
    expect(resolveSwarmBadgeState(false, true)).toBe('running')
  })

  it('lives in the top option row instead of a separate composer row', async () => {
    const inputZoneSource = await Bun.file(new URL('../ChatInputZone.tsx', import.meta.url)).text()
    const optionRowSource = await Bun.file(new URL('../../ActiveOptionBadges.tsx', import.meta.url)).text()

    expect(inputZoneSource).not.toContain('<SwarmToggle')
    expect(optionRowSource).toContain('<SwarmToggle')
    expect(optionRowSource).not.toContain('<StateBadge')
  })

  it('uses the icon library native animation without handwritten motion parameters', async () => {
    const source = await Bun.file(new URL('../SwarmToggle.tsx', import.meta.url)).text()

    expect(source).toContain("from '@/components/ui/atom'")
    expect(source).toContain('iconRef.current?.startAnimation()')
    expect(source).toContain('iconRef.current?.stopAnimation()')
    expect(source).not.toContain("from 'motion/react'")
    expect(source).not.toContain('animate=')
    expect(source).not.toContain('transition=')
    expect(source).not.toContain('duration=')
  })

  it('is a direct on/off toggle with aligned status text and no embedded run controls', async () => {
    const source = await Bun.file(new URL('../SwarmToggle.tsx', import.meta.url)).text()

    expect(source).toContain('handleChange(!enabled)')
    expect(source).toContain('aria-pressed={enabled}')
    expect(source).toContain('text-xs font-normal leading-none')
    expect(source).not.toContain('Popover')
    expect(source).not.toContain('ChevronDown')
    expect(source).not.toContain('onBudgetIncrease')
    expect(source).not.toContain('onStop')
  })
})
