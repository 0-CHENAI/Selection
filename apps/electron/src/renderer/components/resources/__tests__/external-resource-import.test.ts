import { describe, expect, it, mock } from 'bun:test'
import {
  beginMcpJsonImport,
  importSkillFromFile,
  openSkillFilePicker,
  validateMcpImportJsonInput,
  type McpJsonImportApi,
  type SkillFileImportApi,
} from '../external-resource-import'

const workspaceId = 'workspace-1'

function skillPreview(conflict = false) {
  return {
    name: 'Research',
    description: 'Research a topic',
    suggestedSlug: 'research',
    conflict,
    files: ['SKILL.md'],
  }
}

describe('beginMcpJsonImport', () => {
  it('closes the dialog before waiting for MCP creation or authentication', async () => {
    const steps: string[] = []
    const result = { imported: ['anysearch'], skipped: [] }
    const importMcpJson = mock(async () => {
      steps.push('import-started')
      await Promise.resolve()
      steps.push('import-completed')
      return result
    })
    const api = { importMcpJson } satisfies McpJsonImportApi
    const json = JSON.stringify({ mcpServers: { anysearch: { url: 'https://example.com/mcp' } } })

    const pending = beginMcpJsonImport(api, workspaceId, json, () => steps.push('dialog-closed'))

    expect(steps).toEqual(['dialog-closed', 'import-started'])
    await expect(pending).resolves.toEqual(result)
    expect(steps).toEqual(['dialog-closed', 'import-started', 'import-completed'])
    expect(importMcpJson).toHaveBeenCalledWith(workspaceId, json)
  })

  it('keeps malformed or unsupported JSON in the dialog without sending an RPC', () => {
    const onAccepted = mock(() => {})
    const importMcpJson = mock(async () => ({ imported: [], skipped: [] }))
    const api = { importMcpJson } satisfies McpJsonImportApi

    expect(() => beginMcpJsonImport(api, workspaceId, '{', onAccepted)).toThrow('valid JSON')
    expect(() => beginMcpJsonImport(api, workspaceId, '{"hello":true}', onAccepted)).toThrow('No MCP servers')
    expect(onAccepted).not.toHaveBeenCalled()
    expect(importMcpJson).not.toHaveBeenCalled()
  })

  it('accepts mapped, standalone, array, and alternate MCP configuration formats', () => {
    const configurations = [
      { mcpServers: { docs: { command: 'npx' } } },
      { servers: { docs: { url: 'https://example.com/mcp' } } },
      { mcp: { docs: { serverUrl: 'https://example.com/mcp' } } },
      { command: 'uvx' },
      [{ name: 'docs', url: 'https://example.com/mcp' }],
    ]

    for (const configuration of configurations) {
      expect(() => validateMcpImportJsonInput(JSON.stringify(configuration))).not.toThrow()
    }
  })
})

describe('importSkillFromFile', () => {
  it('opens the native picker synchronously without waiting for an RPC round trip', () => {
    const steps: string[] = []
    const input = {
      value: 'previous-skill.md',
      click: mock(() => steps.push('native-picker')),
    }

    openSkillFilePicker(input)
    steps.push('click-handler-finished')

    expect(steps).toEqual(['native-picker', 'click-handler-finished'])
    expect(input.value).toBe('')
    expect(input.click).toHaveBeenCalledTimes(1)
  })

  it('imports a selected Markdown skill without a confirmation dialog', async () => {
    const content = '---\nname: Research\ndescription: Research a topic\n---\n'
    const file = new File([content], 'SKILL.md')
    const previewSkillFileImport = mock(async () => skillPreview())
    const importSkillFile = mock(async () => ({ slug: 'research', skipped: false }))
    const api = {
      previewSkillFileImport,
      importSkillFile,
    } satisfies SkillFileImportApi

    await expect(importSkillFromFile(api, workspaceId, file)).resolves.toEqual({
      status: 'imported',
      slug: 'research',
    })
    expect(previewSkillFileImport).toHaveBeenCalledWith(workspaceId, {
      kind: 'markdown',
      content,
    })
    expect(importSkillFile).toHaveBeenCalledWith(workspaceId, {
      kind: 'markdown',
      content,
    }, { action: 'overwrite' })
  })

  it('imports skill archives without changing their encoded payload', async () => {
    const zipBase64 = 'c2tpbGwtYXJjaGl2ZQ=='
    const file = new File(['skill-archive'], 'research.zip')
    const previewSkillFileImport = mock(async () => skillPreview())
    const importSkillFile = mock(async () => ({ slug: 'research', skipped: false }))
    const api = {
      previewSkillFileImport,
      importSkillFile,
    } satisfies SkillFileImportApi

    await expect(importSkillFromFile(api, workspaceId, file)).resolves.toEqual({
      status: 'imported',
      slug: 'research',
    })
    expect(previewSkillFileImport).toHaveBeenCalledWith(workspaceId, {
      kind: 'zip',
      zipBase64,
    })
    expect(importSkillFile).toHaveBeenCalledWith(workspaceId, {
      kind: 'zip',
      zipBase64,
    }, { action: 'overwrite' })
  })

  it('encodes archives larger than a single base64 conversion chunk', async () => {
    const bytes = Uint8Array.from({ length: 0x8001 }, (_, index) => index % 256)
    const file = new File([bytes], 'research.zip')
    const previewSkillFileImport = mock(async () => skillPreview())
    const importSkillFile = mock(async () => ({ slug: 'research', skipped: false }))
    const api = {
      previewSkillFileImport,
      importSkillFile,
    } satisfies SkillFileImportApi

    await expect(importSkillFromFile(api, workspaceId, file)).resolves.toEqual({
      status: 'imported',
      slug: 'research',
    })
    expect(previewSkillFileImport).toHaveBeenCalledWith(workspaceId, {
      kind: 'zip',
      zipBase64: Buffer.from(bytes).toString('base64'),
    })
  })

  it('skips an existing skill instead of overwriting it without confirmation', async () => {
    const content = '---\nname: Research\ndescription: Research a topic\n---\n'
    const file = new File([content], 'SKILL.md')
    const importSkillFile = mock(async () => ({ slug: 'research', skipped: true }))
    const api = {
      previewSkillFileImport: async () => skillPreview(true),
      importSkillFile,
    } satisfies SkillFileImportApi

    await expect(importSkillFromFile(api, workspaceId, file)).resolves.toEqual({
      status: 'skipped',
      slug: 'research',
    })
    expect(importSkillFile).toHaveBeenCalledWith(workspaceId, {
      kind: 'markdown',
      content,
    }, { action: 'skip' })
  })

  it('rejects oversized Markdown files before reading or importing them', async () => {
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'SKILL.md')
    const previewSkillFileImport = mock(async () => skillPreview())
    const importSkillFile = mock(async () => ({ slug: 'research', skipped: false }))
    const api = { previewSkillFileImport, importSkillFile } satisfies SkillFileImportApi

    await expect(importSkillFromFile(api, workspaceId, file)).rejects.toThrow('2 MB limit')
    expect(previewSkillFileImport).not.toHaveBeenCalled()
    expect(importSkillFile).not.toHaveBeenCalled()
  })

  it('preserves preview errors for the caller to report', async () => {
    const file = new File(['invalid skill'], 'SKILL.md')
    const importSkillFile = mock(async () => ({ slug: 'research', skipped: false }))
    const api = {
      previewSkillFileImport: async () => {
        throw new Error('SKILL.md is missing required frontmatter')
      },
      importSkillFile,
    } satisfies SkillFileImportApi

    await expect(importSkillFromFile(api, workspaceId, file)).rejects.toThrow('required frontmatter')
    expect(importSkillFile).not.toHaveBeenCalled()
  })
})
