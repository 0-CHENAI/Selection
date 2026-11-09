/**
 * Single-connection (`flat`) and multi-provider (`switcher`) share one picker
 * chrome: a model/connection list with thinking nested under the current
 * connection. The effort-first overview card is not a landing surface.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'

const root = resolve(import.meta.dir, '..')

describe('model picker chrome', () => {
  it('does not land the single-connection picker on a thinking overview card', () => {
    const input = readFileSync(resolve(root, 'FreeFormInput.tsx'), 'utf8')
    const compact = readFileSync(resolve(root, 'CompactModelSelector.tsx'), 'utf8')
    const effects = readFileSync(resolve(root, 'PromptBarEffects.tsx'), 'utf8')
    const css = readFileSync(resolve(root, 'PromptBarEffects.css'), 'utf8')

    expect(input).not.toContain('hasThinkingOverview')
    expect(input).not.toContain('modelPickerOverview')
    expect(input).not.toContain('onBrowseModels')
    expect(input).not.toContain('overviewThinkingSettings')
    expect(input).toContain("pickerMode === 'flat' && promptThinkingSettings")
    expect(input).toContain('thinkingSettings={effectiveConnection === browsedConnection.slug ? promptThinkingSettings : undefined}')
    expect(input).toContain('headingAction={fastControl}')

    expect(compact).not.toContain('onBrowseModels')
    expect(compact).not.toContain('hasThinkingOverview')
    expect(compact).toContain('{isCurrentConnection && thinkingControl}')
    expect(compact).toContain('{thinkingControl}')

    expect(effects).not.toContain('onBrowseModels')
    expect(effects).not.toContain('prompt-effort-overview')
    expect(css).not.toContain('prompt-effort-overview')
    expect(css).not.toContain('[data-overview]')
  })
})
