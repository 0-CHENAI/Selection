import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'

const root = resolve(import.meta.dir, '..')

describe('context usage UI entry points', () => {
  it('keeps the send-adjacent ring and drops the old usage surfaces', () => {
    const input = readFileSync(resolve(root, 'input/FreeFormInput.tsx'), 'utf8')
    const compactPicker = readFileSync(resolve(root, 'input/CompactModelSelector.tsx'), 'utf8')
    const info = readFileSync(resolve(root, 'SessionInfoPopover.tsx'), 'utf8')

    expect(input).toContain('ContextUsageIndicator')
    expect(input).not.toContain('click to compact')
    expect(input).not.toContain('chat.tokensUsed')
    expect(compactPicker).not.toContain('chat.modelPicker.contextSection')
    expect(info).not.toContain('chat.usage.title')
  })
})
