import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSource, loadSourceGuide, saveSourceConfig, saveSourceGuide, type FolderSourceConfig } from '@craft-agent/shared/sources'
import { fillMcpGuideIfEmpty, saveMcpGuide } from './mcp-guide'

const PLACEHOLDER = '# Cortex\n\n## Guidelines\n\n(Add usage guidelines here)\n\n## Context\n\n(Add context about this source)\n'
const GUIDE = '# Cortex\n\nUse `search_text` to find indexed passages.\n'
const WORKSPACE_NOTES = '# Cortex\n\nCheck the local reference policy before quoting.\n'

describe('MCP source guide generation and editing', () => {
  let workspaceRoot: string
  let source: FolderSourceConfig

  beforeEach(async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'selection-mcp-guide-'))
    source = await createSource(workspaceRoot, {
      type: 'mcp',
      name: 'Cortex',
      provider: 'custom',
      mcp: { transport: 'http', url: 'https://example.test/mcp', authType: 'none' },
    }, { skipIconDownload: true })
  })

  afterEach(() => rmSync(workspaceRoot, { recursive: true, force: true }))

  test('fills a legacy placeholder once and permits editing the generated guide', async () => {
    saveSourceGuide(workspaceRoot, source.slug, { raw: PLACEHOLDER })
    const generate = mock(async () => GUIDE)
    expect(await fillMcpGuideIfEmpty(workspaceRoot, source, generate)).toBe(true)
    expect(loadSourceGuide(workspaceRoot, source.slug)?.raw).toBe(GUIDE)

    expect(saveMcpGuide(workspaceRoot, source.slug, {
      sourceId: source.id, previous: GUIDE, markdown: WORKSPACE_NOTES,
    })).toBe(WORKSPACE_NOTES)
    expect(await fillMcpGuideIfEmpty(workspaceRoot, source, generate)).toBe(false)
    expect(loadSourceGuide(workspaceRoot, source.slug)?.raw).toBe(WORKSPACE_NOTES)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  test('does not overwrite a guide the user saved with a heading only', async () => {
    const heading = '# My knowledge base\n'
    expect(saveMcpGuide(workspaceRoot, source.slug, {
      sourceId: source.id, previous: '', markdown: heading,
    })).toBe(heading)

    const generate = mock(async () => GUIDE)
    expect(await fillMcpGuideIfEmpty(workspaceRoot, source, generate)).toBe(false)
    expect(generate).not.toHaveBeenCalled()
    expect(loadSourceGuide(workspaceRoot, source.slug)?.raw).toBe(heading)
  })

  test('discards a late AI result when someone saves workspace notes during generation', async () => {
    const draft = Promise.withResolvers<string>()
    const filling = fillMcpGuideIfEmpty(workspaceRoot, source, () => draft.promise)
    expect(saveMcpGuide(workspaceRoot, source.slug, {
      sourceId: source.id, previous: '', markdown: WORKSPACE_NOTES,
    })).toBe(WORKSPACE_NOTES)

    draft.resolve(GUIDE)
    expect(await filling).toBe(false)
    expect(loadSourceGuide(workspaceRoot, source.slug)?.raw).toBe(WORKSPACE_NOTES)
    expect(saveMcpGuide(workspaceRoot, source.slug, {
      sourceId: source.id, previous: '', markdown: GUIDE,
    })).toBeNull()
  })

  test('preserves a deliberate clear and discards a draft from a replaced connection', async () => {
    const draft = Promise.withResolvers<string>()
    const filling = fillMcpGuideIfEmpty(workspaceRoot, source, () => draft.promise)
    saveSourceConfig(workspaceRoot, { ...source, mcp: { ...source.mcp!, url: 'https://example.test/other' } })
    draft.resolve(GUIDE)
    expect(await filling).toBe(false)

    const cleared = saveMcpGuide(workspaceRoot, source.slug, {
      sourceId: source.id, previous: '', markdown: '',
    })
    const updated = { ...source, mcp: { ...source.mcp!, url: 'https://example.test/other' } }
    expect(await fillMcpGuideIfEmpty(workspaceRoot, updated, async () => GUIDE)).toBe(false)
    expect(loadSourceGuide(workspaceRoot, source.slug)?.raw).toBe(cleared!)
  })
})
